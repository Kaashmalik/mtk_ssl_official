import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { readPublishedMatchPlayback } from "@/lib/broadcast-playback"

/**
 * ENH-08-03: the public playback reader.
 *
 * The verified broadcast tables are additive and may not be applied yet, so
 * the reader is flag-gated. When enabled it is tenant+match scoped and the
 * truth decisions stay in the shared contract; when disabled only the legacy
 * live URL is considered.
 */

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select },
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const MATCH = "00000000-0000-4000-8000-0000000000b1"
const SESSION = "00000000-0000-4000-8000-0000000000c1"
const ARCHIVE = "00000000-0000-4000-8000-0000000000d1"
const dialect = new PgDialect()

const publishedMatch = {
  id: MATCH,
  status: "completed" as const,
  streamSource: null,
  streamStatus: "ended" as const,
  liveStreamUrl: null,
}

const sessionRow = {
  id: SESSION,
  provider: "youtube",
  sessionNumber: 1,
  desiredState: "ended",
  observedState: "replay_ready",
  playbackVideoId: "dQw4w9WgXcQ",
  playbackAvailable: true,
  scheduledStartAt: null,
  startedAt: new Date("2026-10-21T10:00:00Z"),
  endedAt: new Date("2026-10-21T12:00:00Z"),
}

const archiveRow = {
  id: ARCHIVE,
  sessionId: SESSION,
  providerVideoId: "dQw4w9WgXcQ",
  status: "ready",
  durationSeconds: 7200,
  availableAt: new Date("2026-10-21T12:30:00Z"),
  retentionUntil: null,
  metadata: null,
}

function selectRows(rows: unknown[]) {
  const capturedWheres: unknown[] = []
  mocks.select.mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      where: (where: unknown) => { capturedWheres.push(where); return chain },
      orderBy: () => Promise.resolve(rows),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    }
    return chain
  })
  return capturedWheres
}

beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.BROADCAST_PLAYBACK_READY
})

afterEach(() => {
  delete process.env.BROADCAST_PLAYBACK_READY
})

describe("ENH-08-03: legacy fallback and publication", () => {
  it("does not query the additive broadcast tables when the flag is off", async () => {
    const catalogue = await readPublishedMatchPlayback(TENANT, {
      ...publishedMatch,
      streamStatus: "live",
      streamSource: "youtube",
      liveStreamUrl: "https://youtu.be/dQw4w9WgXcQ",
    })
    expect(catalogue.state).toBe("live")
    expect(catalogue.live).toMatchObject({ legacy: true, providerVideoId: "dQw4w9WgXcQ" })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("refuses a lookalike legacy host and never promotes an ended URL to replay", async () => {
    const catalogue = await readPublishedMatchPlayback(TENANT, {
      ...publishedMatch,
      streamStatus: "live",
      streamSource: "youtube",
      liveStreamUrl: "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    })
    expect(catalogue.state).toBe("unavailable")

    const ended = await readPublishedMatchPlayback(TENANT, {
      ...publishedMatch,
      streamStatus: "ended",
      streamSource: "youtube",
      liveStreamUrl: "https://youtu.be/dQw4w9WgXcQ",
    })
    expect(ended.state).toBe("unavailable")
    expect(ended.replays).toEqual([])
  })

  it("returns nothing for an unpublished match without reading broadcast rows", async () => {
    const catalogue = await readPublishedMatchPlayback(TENANT, {
      ...publishedMatch,
      status: "cancelled",
      streamStatus: "live",
      streamSource: "youtube",
      liveStreamUrl: "https://youtu.be/dQw4w9WgXcQ",
    })
    expect(catalogue.state).toBe("unavailable")
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

describe("ENH-08-03: verified catalogue read", () => {
  it("reads sessions and archives scoped to the exact tenant and match", async () => {
    process.env.BROADCAST_PLAYBACK_READY = "true"
    const captured = selectRows([sessionRow, archiveRow])

    const catalogue = await readPublishedMatchPlayback(TENANT, publishedMatch)

    expect(catalogue.state).toBe("replay")
    expect(catalogue.replays[0]).toMatchObject({
      providerVideoId: "dQw4w9WgXcQ",
      durationSeconds: 7200,
      legacy: false,
    })
    expect(captured).toHaveLength(2)
    const sessionParams = dialect.sqlToQuery(captured[0] as any).params
    expect(sessionParams).toContain(TENANT)
    expect(sessionParams).toContain(MATCH)
    const archiveParams = dialect.sqlToQuery(captured[1] as any).params
    expect(archiveParams).toContain(TENANT)
    expect(archiveParams).toContain(SESSION)
  })

  it("does not expose a processing archive or an expired retention window", async () => {
    process.env.BROADCAST_PLAYBACK_READY = "true"
    selectRows([sessionRow, { ...archiveRow, status: "processing" }])

    const processing = await readPublishedMatchPlayback(TENANT, publishedMatch)
    expect(processing.replays).toEqual([])
    expect(processing.state).toBe("unavailable")

    vi.resetAllMocks()
    selectRows([sessionRow, { ...archiveRow, retentionUntil: "2026-10-20T00:00:00Z" }])
    const expired = await readPublishedMatchPlayback(TENANT, publishedMatch)
    expect(expired.replays).toEqual([])
    expect(expired.state).toBe("unavailable")
  })
})

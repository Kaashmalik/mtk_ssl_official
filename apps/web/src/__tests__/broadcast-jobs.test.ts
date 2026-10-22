import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  auditLogs, broadcastConnections, broadcastJobs, broadcastSessions, matches,
} from "@mtk/database"
import { BroadcastProviderError } from "@/lib/broadcast-provider"
import { processBroadcastJobs } from "@/lib/broadcast-jobs"

/**
 * ENH-08-02: worker gating, leases, settlement and observation.
 *
 * The worker is exercised with a mocked DB and provider adapter. These pins do
 * not claim provider acceptance; they prove that configuration errors claim
 * nothing, a provider observation is the only path to a live session, and a
 * permanent credential failure cannot leave the session looking live.
 */

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  end: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    execute: mocks.execute,
    select: mocks.select,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/broadcast-provider", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/broadcast-provider")>(),
  prepareBroadcast: mocks.prepare,
  startBroadcast: mocks.start,
  endBroadcast: mocks.end,
  reconcileBroadcast: mocks.reconcile,
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const MATCH = "00000000-0000-4000-8000-0000000000b1"
const SESSION = "00000000-0000-4000-8000-0000000000c1"
const CONNECTION = "00000000-0000-4000-8000-0000000000d1"
const JOB = "00000000-0000-4000-8000-0000000000e1"

function workerSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    tenant_id: TENANT,
    match_id: MATCH,
    session_number: 1,
    provider: "youtube",
    desired_state: "preparing",
    observed_state: "unconfigured",
    provider_broadcast_id: null,
    provider_stream_id: null,
    playback_video_id: null,
    playback_available: false,
    ingest_secret_ref: null,
    revision: 0,
    scheduled_start_at: null,
    started_at: null,
    ended_at: null,
    provider_metadata: {},
    connection_id: CONNECTION,
    connection_status: "active",
    ...overrides,
  }
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB,
    tenant_id: TENANT,
    session_id: SESSION,
    action: "prepare",
    attempts: 1,
    max_attempts: 8,
    lease_owner: "claimed",
    ...overrides,
  }
}

function fakeTx() {
  const updates: { table: unknown; values: any }[] = []
  const inserts: { table: unknown; values: any }[] = []
  const tx = {
    update(table: unknown) {
      return {
        set(values: any) {
          updates.push({ table, values })
          return {
            where: () => Object.assign(Promise.resolve(undefined), {
              returning: async () => table === broadcastJobs ? [{ id: JOB }] : [],
            }),
          }
        },
      }
    },
    insert(table: unknown) {
      return {
        values(values: any) {
          inserts.push({ table, values })
          return Object.assign(Promise.resolve([]), {
            onConflictDoNothing: () => ({ returning: async () => [{ id: "new-job" }] }),
            returning: async () => [{ id: "new-job" }],
          })
        },
      }
    },
    execute: vi.fn(),
  }
  return { tx, updates, inserts }
}

function mockDbWith(options: {
  claimed?: unknown[]
  joined?: unknown[]
  sessionRows?: unknown[]
  sessionUpdateRows?: unknown[]
} = {}) {
  mocks.execute
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(options.claimed ?? [job()])
    .mockResolvedValueOnce(options.sessionRows ?? [workerSession()])

  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => options.joined ?? [{
      credentialRef: "secret://SSL_YOUTUBE",
      connectionStatus: "active",
      destinationExternalId: "channel-1",
      destinationKind: "channel",
      destinationName: "Main channel",
    }],
  }
  mocks.select.mockReturnValue(chain)

  const updates: { table: unknown; values: any }[] = []
  mocks.update.mockImplementation((table: unknown) => ({
    set(values: any) {
      updates.push({ table, values })
      return {
        where: () => Object.assign(Promise.resolve(undefined), {
          returning: async () => table === broadcastSessions
            ? (options.sessionUpdateRows ?? [{ revision: 1 }])
            : [],
        }),
      }
    },
  }))

  const tx = fakeTx()
  mocks.transaction.mockImplementation(async (callback: any) => callback(tx.tx))
  return { updates, tx }
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.BROADCAST_WORKER_READY = "true"
  process.env.BROADCAST_CREDENTIALS_READY = "true"
  process.env.BROADCAST_CREDENTIAL_NAMES = "SSL_YOUTUBE"
  process.env.SSL_YOUTUBE = JSON.stringify({ accessToken: "token-value" })
  process.env.BROADCAST_INGEST_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64")
})

afterEach(() => {
  for (const key of [
    "BROADCAST_WORKER_READY", "BROADCAST_CREDENTIALS_READY", "BROADCAST_CREDENTIAL_NAMES",
    "SSL_YOUTUBE", "BROADCAST_INGEST_ENCRYPTION_KEY",
  ]) delete process.env[key]
})

describe("ENH-08-02: broadcast worker", () => {
  it("claims nothing while the worker gate is off", async () => {
    delete process.env.BROADCAST_WORKER_READY
    await expect(processBroadcastJobs()).resolves.toMatchObject({ enabled: false, claimed: 0 })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("claims nothing without the credential store or ingest key", async () => {
    delete process.env.BROADCAST_CREDENTIALS_READY
    await expect(processBroadcastJobs()).resolves.toMatchObject({ enabled: true, claimed: 0 })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("prepares a session, settles the job and waits for operator Start when ready", async () => {
    const { updates, tx } = mockDbWith()
    mocks.prepare.mockResolvedValue({
      observed: "ready",
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackVideoId: "broadcast-1",
      playbackAvailable: false,
      ingest: { rtmpUrl: "rtmp://example/live", streamKey: "secret-key" },
      providerMetadata: { provider: "youtube" },
      startedAt: null,
      endedAt: null,
      archive: null,
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ claimed: 1, prepared: 1, failed: 0 })

    const sessionUpdate = updates.find(row => row.table === broadcastSessions)?.values
    expect(sessionUpdate).toMatchObject({
      desiredState: "ready",
      observedState: "ready",
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackAvailable: false,
      revision: 1,
    })
    expect(sessionUpdate.ingestSecretRef).toEqual(expect.any(String))
    expect(sessionUpdate.ingestSecretRef).not.toContain("secret-key")

    const jobUpdate = tx.updates.find(row => row.table === broadcastJobs)?.values
    expect(jobUpdate).toMatchObject({ state: "succeeded" })
    // Ready is a stable state. Polling it would spend provider quota without
    // changing what the operator can do; Start enqueues the next job.
    expect(tx.inserts.find(row => row.table === broadcastJobs)).toBeUndefined()
  })

  it("marks a session live only when the provider reports live", async () => {
    const { updates } = mockDbWith({
      claimed: [job({ action: "start" })],
      sessionRows: [workerSession({
        desired_state: "starting",
        observed_state: "ready",
        provider_broadcast_id: "broadcast-1",
        playback_video_id: "broadcast-1",
      })],
    })
    mocks.start.mockResolvedValue({
      observed: "live",
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackVideoId: "broadcast-1",
      playbackAvailable: true,
      ingest: null,
      providerMetadata: { provider: "youtube" },
      startedAt: new Date("2026-10-22T10:00:00Z"),
      endedAt: null,
      archive: null,
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ started: 1 })
    const sessionUpdate = updates.find(row => row.table === broadcastSessions)?.values
    expect(sessionUpdate).toMatchObject({
      desiredState: "live",
      observedState: "live",
      playbackAvailable: true,
    })
  })

  it("does not let a reconcile reopen an operator-requested ending", async () => {
    const { updates } = mockDbWith({
      claimed: [job({ action: "reconcile" })],
      sessionRows: [workerSession({
        desired_state: "ending",
        observed_state: "ready",
        provider_broadcast_id: "broadcast-1",
        playback_video_id: "broadcast-1",
      })],
    })
    mocks.reconcile.mockResolvedValue({
      observed: "live",
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackVideoId: "broadcast-1",
      playbackAvailable: true,
      ingest: null,
      providerMetadata: { provider: "youtube" },
      startedAt: new Date("2026-10-22T10:00:00Z"),
      endedAt: null,
      archive: null,
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ reconciled: 1 })
    const sessionUpdate = updates.find(row => row.table === broadcastSessions)?.values
    expect(sessionUpdate).toMatchObject({ desiredState: "ending", observedState: "live" })
    expect(updates.find(row => row.table === matches)).toBeUndefined()
  })

  it("does not downgrade a verified live badge when the provider read is unknown", async () => {
    const { updates } = mockDbWith({
      claimed: [job({ action: "reconcile" })],
      sessionRows: [workerSession({
        desired_state: "live",
        observed_state: "live",
        playback_available: true,
        provider_broadcast_id: "broadcast-1",
        playback_video_id: "broadcast-1",
      })],
    })
    mocks.reconcile.mockResolvedValue({
      observed: null,
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackVideoId: "broadcast-1",
      playbackAvailable: true,
      ingest: null,
      providerMetadata: { provider: "youtube" },
      startedAt: new Date("2026-10-22T10:00:00Z"),
      endedAt: null,
      archive: null,
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ reconciled: 1 })
    const sessionUpdate = updates.find(row => row.table === broadcastSessions)?.values
    expect(sessionUpdate).toEqual({
      lastErrorCode: "provider_state_unknown",
      revision: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: expect.any(Date),
    })
    expect(updates.find(row => row.table === matches)).toBeUndefined()
  })

  it("never lets a queued Start resurrect a part the operator ended", async () => {
    const { tx } = mockDbWith({
      claimed: [job({ action: "start" })],
      sessionRows: [workerSession({
        desired_state: "ending",
        observed_state: "live",
        provider_broadcast_id: "broadcast-1",
        playback_video_id: "broadcast-1",
      })],
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ reconciled: 1, started: 0 })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(tx.updates.find(row => row.table === broadcastJobs)?.values)
      .toMatchObject({ state: "succeeded", lastErrorCode: null })
  })

  it("does not create a provider object for a cancelled prepare", async () => {
    mockDbWith({
      claimed: [job({ action: "prepare" })],
      sessionRows: [workerSession({
        desired_state: "ended",
        observed_state: "ended",
      })],
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ reconciled: 1, prepared: 0 })
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it("reconciles a retried Start instead of issuing a duplicate transition", async () => {
    mockDbWith({
      claimed: [job({ action: "start", attempts: 2 })],
      sessionRows: [workerSession({
        desired_state: "starting",
        observed_state: "ready",
        provider_broadcast_id: "broadcast-1",
        playback_video_id: "broadcast-1",
      })],
    })
    mocks.reconcile.mockResolvedValue({
      observed: "live",
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackVideoId: "broadcast-1",
      playbackAvailable: true,
      ingest: null,
      providerMetadata: { provider: "youtube" },
      startedAt: new Date("2026-10-22T10:00:00Z"),
      endedAt: null,
      archive: null,
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ started: 1 })
    expect(mocks.reconcile).toHaveBeenCalledTimes(1)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it("refuses a revoked connection without calling the provider", async () => {
    mockDbWith({
      claimed: [job({ action: "reconcile" })],
      sessionRows: [workerSession({
        connection_status: "revoked",
        desired_state: "live",
        observed_state: "live",
        provider_broadcast_id: "broadcast-1",
        playback_video_id: "broadcast-1",
      })],
      joined: [{
        credentialRef: "secret://SSL_YOUTUBE",
        connectionStatus: "revoked",
        destinationExternalId: "channel-1",
        destinationKind: "channel",
        destinationName: "Main channel",
      }],
    })

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ failed: 1, reconciled: 0 })
    expect(mocks.reconcile).not.toHaveBeenCalled()
  })

  it("turns an expired credential into a failed session and expired connection", async () => {
    const { updates } = mockDbWith()
    mocks.prepare.mockRejectedValue(new BroadcastProviderError("credentials_expired", { retryable: false }))

    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ failed: 1, deadLettered: 0 })

    expect(updates.find(row => row.table === broadcastSessions)?.values)
      .toMatchObject({ desiredState: "failed", lastErrorCode: "credentials_expired" })
    expect(updates.find(row => row.table === broadcastConnections)?.values)
      .toMatchObject({ status: "expired" })
  })

  it("does not settle or count a job whose session lease is held", async () => {
    const { tx } = mockDbWith({
      sessionRows: [],
    })
    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ claimed: 1, retrying: 1 })
    expect(mocks.prepare).not.toHaveBeenCalled()
    const jobUpdate = tx.updates.find(row => row.table === broadcastJobs)?.values
    expect(jobUpdate).toMatchObject({ state: "pending", lastErrorCode: "session_lease_held" })
  })

  it("fences a stale session revision and asks for reconciliation", async () => {
    const { tx } = mockDbWith({ sessionUpdateRows: [] })
    mocks.prepare.mockResolvedValue({
      observed: "ready",
      providerBroadcastId: "broadcast-1",
      providerStreamId: "stream-1",
      playbackVideoId: "broadcast-1",
      playbackAvailable: false,
      ingest: null,
      providerMetadata: { provider: "youtube" },
      startedAt: null,
      endedAt: null,
      archive: null,
    })
    const result = await processBroadcastJobs()
    expect(result).toMatchObject({ fenced: 1, prepared: 0 })
    expect(tx.inserts.find(row => row.table === broadcastJobs)?.values)
      .toMatchObject({ action: "reconcile", payload: { reason: "session_fenced" } })
    expect(tx.inserts.some(row => row.table === auditLogs)).toBe(true)
  })
})

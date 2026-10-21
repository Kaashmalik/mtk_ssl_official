import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  auditLogs, mediaAssets, mediaCleanupJobs, mediaQuotas, mediaUploadSessions,
} from "@mtk/database"
import {
  expireStaleMediaUploadSessions,
  processMediaCleanupJobs,
} from "@/lib/media-cleanup"
import { deleteMediaAsset } from "@/lib/media-lifecycle"
import { MediaAuthorizationError } from "@/lib/media-authorization"

/**
 * ENH-07-03: tombstones, durable provider destruction and expiry reconciliation.
 *
 * A tombstone keeps provider identity until destruction is confirmed. Retries
 * are leased/fenced, 404 is idempotent success, auth failures are permanent,
 * and an expired upload session releases its reservation and queues orphan
 * destruction by public id.
 */

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  requireMember: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    execute: mocks.execute,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}))
vi.mock("@/lib/media-authorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/media-authorization")>(),
  requireMediaMember: mocks.requireMember,
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const ACTOR = "00000000-0000-4000-8000-0000000000b1"
const ASSET = "00000000-0000-4000-8000-0000000000c1"
const JOB = "00000000-0000-4000-8000-0000000000d1"

const ACTOR_CTX = { tenantId: TENANT, actorId: ACTOR, clerkId: "clerk_1", role: "league_owner" as const }

function cleanupJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB,
    tenant_id: TENANT,
    asset_id: ASSET,
    provider: "cloudinary",
    provider_public_id: "ssl_abc",
    provider_resource_type: "image",
    action: "destroy_provider_asset",
    attempts: 1,
    ...overrides,
  }
}

function updateResult(rows: unknown[] = [{ id: JOB }]) {
  const updates: { table: unknown; values: any }[] = []
  mocks.update.mockImplementation((table: unknown) => ({
    set(values: any) {
      updates.push({ table, values })
      return { where: () => ({ returning: async () => rows }) }
    },
  }))
  return updates
}

function fakeTx(options: {
  selectQueue?: unknown[][]
  asset?: unknown
} = {}) {
  const queue = [...(options.selectQueue ?? [])]
  const inserts: { table: unknown; values: any }[] = []
  const updates: { table: unknown; values: any }[] = []
  const tx = {
    select() {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        for: () => chain,
        limit: async () => queue.shift() ?? [],
      }
      return chain
    },
    insert(table: unknown) {
      return {
        values(values: any) {
          inserts.push({ table, values })
          const rows = table === mediaCleanupJobs
            ? (Array.isArray(values) ? values : [values]).map((_, index) => ({ id: `job-${index}` }))
            : undefined
          return Object.assign(Promise.resolve(rows), {
            onConflictDoNothing: () => ({ returning: async () => rows ?? [] }),
            returning: async () => rows ?? [],
          })
        },
      }
    },
    update(table: unknown) {
      return {
        set(values: any) {
          updates.push({ table, values })
          return { where: async () => undefined }
        },
      }
    },
  }
  return { tx: tx as any, inserts, updates }
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CLOUDINARY_CLOUD_NAME = "ssl-test"
  process.env.CLOUDINARY_API_KEY = "key"
  process.env.CLOUDINARY_API_SECRET = "secret"
  process.env.MEDIA_CLEANUP_READY = "true"
  mocks.requireMember.mockResolvedValue(ACTOR_CTX)
  vi.stubGlobal("fetch", mocks.fetch)
})

afterEach(() => {
  for (const key of [
    "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
    "MEDIA_CLEANUP_READY",
  ]) delete process.env[key]
  vi.unstubAllGlobals()
})

describe("ENH-07-03: cleanup worker", () => {
  it("claims nothing while the provider gate is off", async () => {
    delete process.env.MEDIA_CLEANUP_READY
    await expect(processMediaCleanupJobs()).resolves.toEqual({
      enabled: false, claimed: 0, destroyed: 0, retrying: 0, failed: 0, deadLettered: 0,
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("leaves every job pending when provider credentials are absent", async () => {
    delete process.env.CLOUDINARY_API_SECRET
    await expect(processMediaCleanupJobs()).resolves.toEqual({
      enabled: true, claimed: 0, destroyed: 0, retrying: 0, failed: 0, deadLettered: 0,
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("claims a batch, destroys the provider asset and settles on the lease", async () => {
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([cleanupJob()])
    const updates = updateResult()
    mocks.fetch.mockResolvedValue(new Response(
      JSON.stringify({ deleted: { ssl_abc: "deleted" } }),
      { status: 200 },
    ))

    const result = await processMediaCleanupJobs()
    expect(result).toMatchObject({ claimed: 1, destroyed: 1 })
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/resources/image/upload?public_ids=ssl_abc&invalidate=true"),
      expect.objectContaining({ method: "DELETE" }),
    )
    expect(updates.find(row => row.table === mediaCleanupJobs)?.values)
      .toMatchObject({ state: "provider_destroyed", leaseToken: null, lastError: null })
  })

  it("treats provider 404 as an idempotent destruction", async () => {
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([cleanupJob()])
    updateResult()
    mocks.fetch.mockResolvedValue(new Response("", { status: 404 }))
    await expect(processMediaCleanupJobs()).resolves.toMatchObject({ destroyed: 1 })
  })

  it("retries transport uncertainty and dead-letters an exhausted lease", async () => {
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([cleanupJob()])
    const updates = updateResult()
    mocks.fetch.mockRejectedValue(new Error("network"))
    const retry = await processMediaCleanupJobs()
    expect(retry).toMatchObject({ retrying: 1 })
    expect(updates.at(-1)?.values).toMatchObject({
      state: "pending", lastError: "network_unknown",
    })
    expect(updates.at(-1)?.values.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())

    vi.resetAllMocks()
    process.env.MEDIA_CLEANUP_READY = "true"
    vi.stubGlobal("fetch", mocks.fetch)
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
      cleanupJob({ attempts: 8 }),
    ])
    const finalUpdates = updateResult()
    mocks.fetch.mockRejectedValue(new Error("network"))
    const dead = await processMediaCleanupJobs()
    expect(dead).toMatchObject({ deadLettered: 1 })
    expect(finalUpdates.at(-1)?.values).toMatchObject({ state: "dead_lettered" })
  })

  it("marks provider auth refusal as a permanent failure instead of retrying forever", async () => {
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([cleanupJob()])
    const updates = updateResult()
    mocks.fetch.mockResolvedValue(new Response("", { status: 401 }))
    const result = await processMediaCleanupJobs()
    expect(result).toMatchObject({ failed: 1 })
    expect(updates.at(-1)?.values).toMatchObject({
      state: "failed", lastError: "provider_auth_401",
    })
  })

  it("resolves local delivery invalidation without calling the provider", async () => {
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
      cleanupJob({ action: "invalidate_delivery" }),
    ])
    const updates = updateResult()
    await expect(processMediaCleanupJobs()).resolves.toMatchObject({ destroyed: 1 })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(updates.at(-1)?.values).toMatchObject({ state: "provider_destroyed" })
  })

  it("does not count a settlement whose lease was stolen", async () => {
    mocks.execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([cleanupJob()])
    updateResult([])
    mocks.fetch.mockResolvedValue(new Response(
      JSON.stringify({ deleted: { ssl_abc: "deleted" } }), { status: 200 },
    ))
    await expect(processMediaCleanupJobs()).resolves.toMatchObject({
      claimed: 1, destroyed: 0,
    })
  })
})

describe("ENH-07-03: expiry reconciliation", () => {
  it("releases reservations, expires sessions and queues orphan destruction", async () => {
    const sessions = [
      { id: "s1", tenantId: TENANT, kind: "image", provider: "cloudinary", providerPublicId: "ssl_1", reservedBytes: 100 },
      { id: "s2", tenantId: TENANT, kind: "video", provider: "cloudinary", providerPublicId: "ssl_2", reservedBytes: 200 },
    ]
    const { tx, inserts, updates } = fakeTx({
      selectQueue: [sessions, [{ reservedBytes: 500 }]],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    const result = await expireStaleMediaUploadSessions()
    expect(result).toEqual({ expiredSessions: 2, cleanupJobsQueued: 4 })
    expect(updates.find(row => row.table === mediaQuotas)?.values)
      .toMatchObject({ reservedBytes: 200 })
    expect(updates.find(row => row.table === mediaUploadSessions)?.values)
      .toMatchObject({ state: "expired" })

    const cleanup = inserts
      .filter(row => row.table === mediaCleanupJobs)
      .flatMap(row => row.values)
    expect(cleanup).toHaveLength(4)
    expect(cleanup[0]).toMatchObject({
      assetId: null, providerPublicId: "ssl_1", action: "destroy_provider_asset",
    })
  })

  it("does nothing when no session is due", async () => {
    const { tx } = fakeTx({ selectQueue: [[]] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    await expect(expireStaleMediaUploadSessions()).resolves.toEqual({
      expiredSessions: 0, cleanupJobsQueued: 0,
    })
  })
})

describe("ENH-07-03: tombstone deletion", () => {
  function asset(overrides: Record<string, unknown> = {}) {
    return {
      id: ASSET, tenantId: TENANT, provider: "cloudinary", providerPublicId: "ssl_abc",
      resourceType: "image", state: "ready", ...overrides,
    }
  }

  it("tombstones a ready asset and queues both cleanup actions", async () => {
    const { tx, inserts, updates } = fakeTx({ selectQueue: [[asset()]] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    const result = await deleteMediaAsset({ assetId: ASSET })
    expect(result).toEqual({ ok: true, assetId: ASSET, cleanupJobs: 2 })
    expect(updates.find(row => row.table === mediaAssets)?.values)
      .toMatchObject({ state: "deleted", publication: "withdrawn" })
    expect(inserts.find(row => row.table === mediaCleanupJobs)?.values).toHaveLength(2)
    expect(inserts.some(row => row.table === auditLogs)).toBe(true)
  })

  it("refuses a non-owner before touching the asset", async () => {
    mocks.requireMember.mockResolvedValue({ ...ACTOR_CTX, role: "team_manager" })
    await expect(deleteMediaAsset({ assetId: ASSET })).rejects.toMatchObject({
      code: "permission_denied",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("returns not-found for a foreign asset", async () => {
    const { tx } = fakeTx({ selectQueue: [[]] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    await expect(deleteMediaAsset({ assetId: ASSET })).resolves.toEqual({
      ok: false, reason: "not_found",
    })
  })

  it("is idempotent for an already-deleted tombstone", async () => {
    const { tx, inserts } = fakeTx({ selectQueue: [[asset({ state: "deleted" })]] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    await expect(deleteMediaAsset({ assetId: ASSET })).resolves.toEqual({
      ok: true, assetId: ASSET, cleanupJobs: 0,
    })
    expect(inserts.some(row => row.table === mediaCleanupJobs)).toBe(false)
  })

  it("keeps the provider identity out of errors while refusing a non-owner", async () => {
    mocks.requireMember.mockResolvedValue({ ...ACTOR_CTX, role: "fan" })
    await expect(deleteMediaAsset({ assetId: ASSET }))
      .rejects.toBeInstanceOf(MediaAuthorizationError)
  })
})

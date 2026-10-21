import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mediaAssets, mediaQuotas, mediaUploadSessions } from "@mtk/database"
import { MediaAuthorizationError } from "@/lib/media-authorization"
import { MediaUploadError, authorizeMediaUpload, finalizeMediaUpload, getMediaUploadStatus } from "@/lib/media-uploads"
import type { ProviderAsset } from "@/lib/media-provider"

/**
 * ENH-07-02: authorize/finalize commands.
 *
 * Authorize refuses closed by default (limits, provider, scope, quota) before a
 * signature exists. Finalize re-reads the locked session after provider I/O, so
 * expiry, duplicate finalize and forged metadata cannot double-count quota or
 * produce a ready asset.
 */

const mocks = vi.hoisted(() => ({
  requireMediaActor: vi.fn(),
  requireMediaMember: vi.fn(),
  assertMediaResourceAccess: vi.fn(),
  fetchProviderAsset: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/media-authorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/media-authorization")>(),
  requireMediaActor: mocks.requireMediaActor,
  requireMediaMember: mocks.requireMediaMember,
  assertMediaResourceAccess: mocks.assertMediaResourceAccess,
}))

vi.mock("@/lib/media-provider", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/media-provider")>(),
  fetchProviderAsset: mocks.fetchProviderAsset,
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: mocks.select,
    transaction: mocks.transaction,
  },
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const ACTOR = "00000000-0000-4000-8000-0000000000b1"
const SESSION = "00000000-0000-4000-8000-0000000000c1"
const ASSET = "00000000-0000-4000-8000-0000000000d1"
const TEAM = "00000000-0000-4000-8000-0000000000e1"
const PLAYER = "00000000-0000-4000-8000-0000000000f1"

const ACTOR_CTX = { tenantId: TENANT, actorId: ACTOR, clerkId: "clerk_1", role: "league_owner" as const }

const DECLARATION = {
  kind: "image" as const,
  mimeType: "image/png",
  bytes: 4_000,
  bindingType: "team" as const,
  resourceId: TEAM,
}

function providerAsset(overrides: Partial<ProviderAsset> = {}): ProviderAsset {
  return {
    assetId: "asset-1",
    publicId: "ssl_abc",
    version: 17,
    resourceType: "image",
    deliveryType: "upload",
    format: "png",
    bytes: 4_000,
    width: 800,
    height: 600,
    durationSeconds: null,
    secureUrl: "https://res.cloudinary.com/x",
    createdAt: "2026-10-21T10:00:00Z",
    ...overrides,
  }
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    tenantId: TENANT,
    userId: ACTOR,
    kind: "image",
    state: "reserved",
    bindingType: "player",
    resourceId: PLAYER,
    provider: "cloudinary",
    providerPublicId: "ssl_abc",
    providerFolder: null,
    declaredMimeType: "image/png",
    declaredBytes: 4_000,
    reservedBytes: 4_000,
    assetId: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    finalizedAt: null,
    ...overrides,
  }
}

type TxOptions = {
  locks?: unknown[][]
  insertId?: string
  updateResults?: unknown[][]
}

function fakeTx(options: TxOptions = {}) {
  const locks = [...(options.locks ?? [])]
  const inserts: { table: unknown; values: any }[] = []
  const updates: { table: unknown; values: any; where?: unknown }[] = []
  const tx = {
    insert(table: unknown) {
      return {
        values(values: any) {
          inserts.push({ table, values })
          return {
            onConflictDoNothing: () => ({
              returning: async () => [{ id: options.insertId ?? ASSET }],
            }),
            returning: async () => [{ id: options.insertId ?? ASSET }],
          }
        },
      }
    },
    select() {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        for: () => chain,
        limit: async () => locks.shift() ?? [],
      }
      return chain
    },
    update(table: unknown) {
      return {
        set(values: any) {
          return {
            where(where: unknown) {
              updates.push({ table, values, where })
              const result = options.updateResults?.shift() ?? [{ id: SESSION }]
              return Object.assign(Promise.resolve(result), {
                returning: async () => result,
              })
            },
          }
        },
      }
    },
  }
  return { tx: tx as any, inserts, updates }
}

function readSession(row: unknown) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: async () => [row],
  }
  mocks.select.mockReturnValue(chain)
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CLOUDINARY_CLOUD_NAME = "ssl-test"
  process.env.CLOUDINARY_API_KEY = "key"
  process.env.CLOUDINARY_API_SECRET = "secret"
  process.env.MEDIA_IMAGE_MAX_BYTES = "10000"
  process.env.MEDIA_IMAGE_MIME_TYPES = "image/png,image/jpeg"
  mocks.requireMediaActor.mockResolvedValue(ACTOR_CTX)
  mocks.requireMediaMember.mockResolvedValue(ACTOR_CTX)
  mocks.assertMediaResourceAccess.mockResolvedValue(undefined)
  mocks.fetchProviderAsset.mockResolvedValue({ ok: true, asset: providerAsset() })
})

afterEach(() => {
  for (const key of [
    "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
    "MEDIA_IMAGE_MAX_BYTES", "MEDIA_IMAGE_MIME_TYPES",
  ]) delete process.env[key]
})

describe("ENH-07-02: authorize fails closed", () => {
  it("refuses before any transaction when deployment limits are absent", async () => {
    delete process.env.MEDIA_IMAGE_MAX_BYTES
    await expect(authorizeMediaUpload(DECLARATION)).rejects.toMatchObject({
      code: "limits_unconfigured",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("refuses without provider configuration", async () => {
    delete process.env.CLOUDINARY_API_SECRET
    await expect(authorizeMediaUpload(DECLARATION)).rejects.toMatchObject({
      code: "provider_unconfigured",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("refuses a foreign resource before a signature or reservation", async () => {
    mocks.assertMediaResourceAccess.mockRejectedValue(new MediaAuthorizationError("foreign_resource"))
    await expect(authorizeMediaUpload(DECLARATION)).rejects.toMatchObject({
      code: "foreign_resource",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("refuses when the league has no approved quota", async () => {
    const { tx, inserts } = fakeTx({ locks: [[{ limitBytes: null, usedBytes: 0, reservedBytes: 0 }]] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    await expect(authorizeMediaUpload(DECLARATION)).rejects.toMatchObject({
      code: "quota_unconfigured",
    })
    expect(inserts.some(row => row.table === mediaUploadSessions)).toBe(false)
  })

  it("refuses a reservation that would exceed used + reserved", async () => {
    const { tx, inserts } = fakeTx({
      locks: [[{ limitBytes: 50_000, usedBytes: 47_000, reservedBytes: 0 }]],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    await expect(authorizeMediaUpload(DECLARATION)).rejects.toMatchObject({
      code: "quota_exceeded",
      detail: "quota_exceeded",
    })
    expect(inserts.some(row => row.table === mediaUploadSessions)).toBe(false)
  })

  it("reserves the declared bytes and returns one signed, server-owned request", async () => {
    const { tx, inserts, updates } = fakeTx({
      locks: [[{ limitBytes: 50_000, usedBytes: 1_000, reservedBytes: 0 }]],
      insertId: SESSION,
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    const result = await authorizeMediaUpload(DECLARATION)
    expect(result.sessionId).toBe(SESSION)
    expect(result.uploadUrl).toBe("https://api.cloudinary.com/v1_1/ssl-test/image/upload")
    expect(result.params.public_id).toMatch(/^ssl_[0-9a-f]{32}$/)
    expect(result.params.public_id).not.toContain(TENANT)
    expect(result.params.signature).toMatch(/^[0-9a-f]{40}$/)

    const created = inserts.find(row => row.table === mediaUploadSessions)?.values
    expect(created).toMatchObject({
      tenantId: TENANT,
      userId: ACTOR,
      kind: "image",
      bindingType: "team",
      resourceId: TEAM,
      declaredMimeType: "image/png",
      declaredBytes: 4_000,
      reservedBytes: 4_000,
      provider: "cloudinary",
    })
    expect(created.expiresAt).toBeInstanceOf(Date)
    const reserved = updates.find(row => row.table === mediaQuotas)?.values
    expect(reserved).toMatchObject({ reservedBytes: 4_000 })
  })
})

describe("ENH-07-02: finalize trusts only authoritative metadata", () => {
  it("refuses a duplicate finalize before any provider call", async () => {
    readSession(session({ state: "finalized", assetId: ASSET }))
    await expect(finalizeMediaUpload({ sessionId: SESSION })).rejects.toMatchObject({
      code: "already_finalized",
    })
    expect(mocks.fetchProviderAsset).not.toHaveBeenCalled()
  })

  it("refuses a session owned by a different actor", async () => {
    readSession(session({ userId: "00000000-0000-4000-8000-0000000000ff" }))
    await expect(finalizeMediaUpload({ sessionId: SESSION })).rejects.toMatchObject({
      code: "session_not_owner",
    })
    expect(mocks.fetchProviderAsset).not.toHaveBeenCalled()
  })

  it("releases an expired reservation without calling the provider", async () => {
    readSession(session({ expiresAt: new Date(Date.now() - 1_000) }))
    const { tx, updates } = fakeTx({
      locks: [
        [session({ expiresAt: new Date(Date.now() - 1_000) })],
        [{ reservedBytes: 4_000 }],
      ],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    await expect(finalizeMediaUpload({ sessionId: SESSION })).rejects.toMatchObject({
      code: "session_expired",
    })
    expect(mocks.fetchProviderAsset).not.toHaveBeenCalled()
    expect(updates.find(row => row.table === mediaQuotas)?.values)
      .toMatchObject({ reservedBytes: 0 })
  })

  it("keeps the reservation when the provider object is not ready", async () => {
    readSession(session())
    mocks.fetchProviderAsset.mockResolvedValue({ ok: false, reason: "provider_not_found" })
    await expect(finalizeMediaUpload({ sessionId: SESSION })).rejects.toMatchObject({
      code: "provider_not_found",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("commits a quarantined evidence row for a forged format and releases the reservation", async () => {
    readSession(session({ declaredMimeType: "image/jpeg" }))
    mocks.fetchProviderAsset.mockResolvedValue({
      ok: true,
      asset: providerAsset({ format: "png" }),
    })
    const { tx, inserts, updates } = fakeTx({
      locks: [
        [session({ declaredMimeType: "image/jpeg" })],
        [{ limitBytes: 50_000, usedBytes: 1_000, reservedBytes: 4_000 }],
      ],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    const result = await finalizeMediaUpload({ sessionId: SESSION })
    expect(result).toMatchObject({
      ok: false, reason: "quarantined", assetId: ASSET, detail: "mime_mismatch",
    })
    const created = inserts.find(row => row.table === mediaAssets)?.values
    expect(created).toMatchObject({ state: "quarantined", publication: "unpublished", bytes: 4_000 })
    expect(created.metadata).toMatchObject({ reason: "mime_mismatch" })
    expect(updates.find(row => row.table === mediaQuotas)?.values)
      .toMatchObject({ reservedBytes: 0, usedBytes: 5_000 })
  })

  it("quarantines bytes that exceed the signed declaration", async () => {
    readSession(session())
    mocks.fetchProviderAsset.mockResolvedValue({
      ok: true,
      asset: providerAsset({ bytes: 4_001 }),
    })
    const { tx } = fakeTx({
      locks: [[session()], [{ limitBytes: 50_000, usedBytes: 0, reservedBytes: 4_000 }]],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    await expect(finalizeMediaUpload({ sessionId: SESSION })).resolves.toMatchObject({
      ok: false, reason: "quarantined", detail: "bytes_exceed_declared",
    })
  })

  it("records a ready but unpublished asset and never exceeds the reserved quota", async () => {
    readSession(session())
    const { tx, inserts, updates } = fakeTx({
      locks: [[session()], [{ limitBytes: 50_000, usedBytes: 1_000, reservedBytes: 4_000 }]],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    const result = await finalizeMediaUpload({ sessionId: SESSION })
    expect(result).toEqual({
      ok: true, assetId: ASSET, state: "ready", publication: "unpublished",
    })

    const created = inserts.find(row => row.table === mediaAssets)?.values
    expect(created).toMatchObject({
      tenantId: TENANT,
      state: "ready",
      publication: "unpublished",
      consent: "pending",
      mimeType: "image/png",
      format: "png",
      bytes: 4_000,
      providerAssetId: "asset-1",
      providerVersion: 17,
    })
    expect(created.metadata.source).toBe("provider_admin_api")

    expect(updates.find(row => row.table === mediaQuotas)?.values)
      .toMatchObject({ reservedBytes: 0, usedBytes: 5_000 })
    expect(updates.find(row => row.table === mediaUploadSessions)?.values)
      .toMatchObject({ state: "finalized", assetId: ASSET })
  })

  it("refuses a concurrent finalize when the locked row has already settled", async () => {
    readSession(session())
    const { tx, inserts } = fakeTx({
      locks: [[session({ state: "finalized", assetId: ASSET })]],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    await expect(finalizeMediaUpload({ sessionId: SESSION })).rejects.toBeInstanceOf(MediaUploadError)
    expect(inserts.some(row => row.table === mediaAssets)).toBe(false)
  })
})

describe("ENH-07-04: owner-scoped upload reconciliation", () => {
  it("reports a reserved session without inventing an asset", async () => {
    readSession(session())
    await expect(getMediaUploadStatus({ sessionId: SESSION })).resolves.toMatchObject({
      sessionId: SESSION,
      state: "reserved",
      bindingType: "player",
      resourceId: PLAYER,
      assetId: null,
      assetState: null,
    })
  })

  it("reports the committed asset state after a lost finalize response", async () => {
    readSession(session({ state: "finalized", assetId: ASSET }))
    const assetChain: any = {
      from: () => assetChain,
      where: () => assetChain,
      limit: async () => [{ state: "quarantined" }],
    }
    mocks.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [session({ state: "finalized", assetId: ASSET })],
        }),
      }),
    }).mockReturnValueOnce(assetChain)

    await expect(getMediaUploadStatus({ sessionId: SESSION })).resolves.toMatchObject({
      state: "finalized",
      assetId: ASSET,
      assetState: "quarantined",
    })
  })

  it("hides another user's or tenant's session", async () => {
    readSession(null)
    await expect(getMediaUploadStatus({ sessionId: SESSION }))
      .rejects.toMatchObject({ code: "session_not_found" })
  })
})

import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mediaAssets, mediaProcessingEvents } from "@mtk/database"
import {
  receiveCloudinaryWebhook,
  verifyCloudinaryWebhookSignature,
} from "@/lib/media-webhook"

/**
 * ENH-07-03: webhook authentication and application.
 *
 * The signature covers the RAW body + timestamp. Dedup is a content hash, not
 * a timestamp. A verified poison payload is quarantined; an unverified one is
 * 401. An upload that disagrees with the finalized provider identity is never
 * silently accepted.
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  insert: vi.fn(),
  enqueueCleanup: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction, insert: mocks.insert },
}))
vi.mock("@/lib/media-cleanup", () => ({ enqueueMediaCleanupJobs: mocks.enqueueCleanup }))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const ASSET = "00000000-0000-4000-8000-0000000000b1"
const SECRET = "secret"
const NOW_SECONDS = 1_792_576_800
const NOW = new Date(NOW_SECONDS * 1_000)

type InsertRow = { table: unknown; values: any }
type UpdateRow = { table: unknown; values: any }

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET,
    tenantId: TENANT,
    provider: "cloudinary",
    providerPublicId: "ssl_abc",
    providerVersion: 17,
    resourceType: "image",
    format: "png",
    bytes: 4_000,
    state: "ready",
    publication: "published",
    ...overrides,
  }
}

function fakeTx(options: {
  assets?: unknown[]
  eventReturn?: unknown[]
} = {}) {
  const inserts: InsertRow[] = []
  const updates: UpdateRow[] = []
  const tx = {
    select() {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        for: () => chain,
        limit: async () => options.assets ?? [],
      }
      return chain
    },
    insert(table: unknown) {
      return {
        values(values: any) {
          inserts.push({ table, values })
          return {
            onConflictDoNothing: () => ({
              returning: async () => options.eventReturn ?? [{ id: "event-1" }],
            }),
          }
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

function sign(body: string, timestamp = NOW_SECONDS): string {
  return createHash("sha1").update(`${body}${timestamp}${SECRET}`).digest("hex")
}

function uploadBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    notification_type: "upload",
    public_id: "ssl_abc",
    resource_type: "image",
    type: "upload",
    bytes: 4_000,
    format: "png",
    version: 17,
    ...overrides,
  })
}

async function receive(body: string, timestamp = NOW_SECONDS, signature = sign(body, timestamp)) {
  return receiveCloudinaryWebhook({
    rawBody: body,
    timestamp: String(timestamp),
    signature,
    now: NOW,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CLOUDINARY_CLOUD_NAME = "ssl-test"
  process.env.CLOUDINARY_API_KEY = "key"
  process.env.CLOUDINARY_API_SECRET = SECRET
  delete process.env.CLOUDINARY_SIGNATURE_ALGORITHM
  mocks.enqueueCleanup.mockResolvedValue(2)
})

afterEach(() => {
  for (const key of [
    "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
    "CLOUDINARY_SIGNATURE_ALGORITHM",
  ]) delete process.env[key]
})

describe("ENH-07-03: webhook signature", () => {
  it("verifies raw body + timestamp + secret and rejects any mismatch", () => {
    const body = uploadBody()
    expect(verifyCloudinaryWebhookSignature({
      rawBody: body, timestamp: String(NOW_SECONDS), signature: sign(body), apiSecret: SECRET,
    })).toBe(true)
    expect(verifyCloudinaryWebhookSignature({
      rawBody: body, timestamp: String(NOW_SECONDS), signature: sign(body, NOW_SECONDS + 1), apiSecret: SECRET,
    })).toBe(false)
    expect(verifyCloudinaryWebhookSignature({
      rawBody: body, timestamp: String(NOW_SECONDS), signature: sign(body), apiSecret: "other",
    })).toBe(false)
    expect(verifyCloudinaryWebhookSignature({
      rawBody: body, timestamp: String(NOW_SECONDS), signature: "zz", apiSecret: SECRET,
    })).toBe(false)
  })

  it("refuses missing configuration, missing headers, bad signatures and stale timestamps", async () => {
    delete process.env.CLOUDINARY_API_SECRET
    expect((await receive(uploadBody())).httpStatus).toBe(503)

    process.env.CLOUDINARY_API_SECRET = SECRET
    expect((await receiveCloudinaryWebhook({
      rawBody: uploadBody(), timestamp: null, signature: null, now: NOW,
    })).httpStatus).toBe(401)

    expect((await receive(uploadBody(), NOW_SECONDS, "deadbeef")).httpStatus).toBe(401)
    const stale = NOW_SECONDS - 7_201
    expect((await receive(uploadBody(), stale)).httpStatus).toBe(401)
  })
})

describe("ENH-07-03: verified webhook application", () => {
  it("quarantines an invalid JSON payload after verification", async () => {
    const body = "{not-json"
    mocks.insert.mockReturnValue({
      values: () => ({ onConflictDoNothing: async () => undefined }),
    })
    const result = await receive(body)
    expect(result).toEqual({ httpStatus: 200, body: { status: "quarantined", reason: "invalid_json" } })
    expect(mocks.insert).toHaveBeenCalledWith(mediaProcessingEvents)
  })

  it("deduplicates a replayed body without touching the asset", async () => {
    const { tx, updates } = fakeTx({ assets: [asset()], eventReturn: [] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    const result = await receive(uploadBody())
    expect(result).toEqual({ httpStatus: 200, body: { status: "duplicate" } })
    expect(updates).toHaveLength(0)
  })

  it("accepts an upload notification that matches the finalized identity", async () => {
    const { tx, updates } = fakeTx({ assets: [asset()] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    const result = await receive(uploadBody())
    expect(result).toEqual({ httpStatus: 200, body: { status: "applied" } })
    expect(updates.filter(row => row.table === mediaAssets)).toHaveLength(0)
    expect(updates.find(row => row.table === mediaProcessingEvents)?.values)
      .toMatchObject({ state: "applied" })
    expect(mocks.enqueueCleanup).not.toHaveBeenCalled()
  })

  it("quarantines a replaced provider version and queues destruction", async () => {
    const { tx, updates } = fakeTx({
      assets: [asset()],
      eventReturn: [{ id: "event-1" }],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    const result = await receive(uploadBody({ version: 18 }))
    expect(result).toEqual({
      httpStatus: 200, body: { status: "quarantined", reason: "provider_version_changed" },
    })
    expect(updates.find(row => row.table === mediaAssets)?.values)
      .toMatchObject({ state: "quarantined", publication: "withdrawn" })
    expect(updates.find(row => row.table === mediaProcessingEvents)?.values)
      .toMatchObject({ state: "quarantined", error: "provider_version_changed" })
    expect(mocks.enqueueCleanup).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ assetId: ASSET, actions: ["destroy_provider_asset", "invalidate_delivery"] }),
    )
  })

  it("tombstones on a verified delete and queues cleanup", async () => {
    const { tx, updates } = fakeTx({ assets: [asset()] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    const body = JSON.stringify({
      notification_type: "delete",
      public_id: "ssl_abc",
      resource_type: "image",
      type: "upload",
    })
    const result = await receive(body)
    expect(result).toEqual({ httpStatus: 200, body: { status: "applied" } })
    expect(updates.find(row => row.table === mediaAssets)?.values)
      .toMatchObject({ state: "deleted", publication: "withdrawn" })
    expect(mocks.enqueueCleanup).toHaveBeenCalled()
  })

  it("quarantines unknown, unmanaged and unsupported notifications", async () => {
    const unknown = fakeTx({ assets: [] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(unknown.tx))
    expect(await receive(uploadBody())).toMatchObject({
      body: { status: "quarantined", reason: "asset_not_found" },
    })

    const unmanaged = fakeTx({ assets: [] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(unmanaged.tx))
    expect(await receive(uploadBody({ public_id: "legacy/logo" }))).toMatchObject({
      body: { status: "quarantined", reason: "unmanaged_public_id" },
    })

    const unsupported = fakeTx({ assets: [] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(unsupported.tx))
    expect(await receive(uploadBody({ notification_type: "moderation" }))).toMatchObject({
      body: { status: "quarantined", reason: "unsupported_notification_type" },
    })
  })
})

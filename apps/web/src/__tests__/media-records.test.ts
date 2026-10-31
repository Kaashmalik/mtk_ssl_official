import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  cloudinaryDeliveryUrl,
  findDeliverableMediaAsset,
  findPublishedMediaDeliveryUrl,
  legacyMediaRecord,
  toPublicMediaRecord,
} from "@/lib/media-records"

/**
 * ENH-07-01: media projections.
 *
 * A legacy row is classified, never promoted. A verified projection excludes
 * provider locators/metadata and is refused by the shared gate. Reads are
 * tenant-scoped in SQL, not filtered after a global fetch.
 */

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select },
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000a2"
const ASSET = "00000000-0000-4000-8000-0000000000b1"
const dialect = new PgDialect()

const ASSET_ROW = {
  id: ASSET, kind: "image", state: "ready", publication: "published",
  format: "png", width: 800, height: 600, durationSeconds: null,
}

function selectRows(rows: unknown[]) {
  const captured: { where?: unknown; limit?: number } = {}
  mocks.select.mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      where: (where: unknown) => { captured.where = where; return chain },
      limit: (limit: number) => { captured.limit = limit; return Promise.resolve(rows) },
    }
    return chain
  })
  return captured
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("ENH-07-01: legacy media is never promoted", () => {
  it("classifies a pre-contract row with a stored URL as unverified and unpublished", () => {
    const record = legacyMediaRecord({
      id: ASSET,
      fileUrl: "https://res.cloudinary.com/cloud/image/upload/v1/ssl-admin/logo.png",
    } as any)
    expect(record).toEqual({
      id: ASSET,
      state: "legacy_unverified",
      publication: "unpublished",
      needsAuthoritativeRecheck: true,
      source: "legacy",
    })
  })
})

describe("ENH-07-01: public projection", () => {
  it("returns descriptive fields only for a ready+published asset", () => {
    expect(toPublicMediaRecord(ASSET_ROW)).toEqual({
      id: ASSET, kind: "image", format: "png", width: 800, height: 600, durationSeconds: null,
    })
  })

  it("refuses unready, unpublished and legacy states", () => {
    expect(toPublicMediaRecord({ ...ASSET_ROW, state: "processing" })).toBeNull()
    expect(toPublicMediaRecord({ ...ASSET_ROW, publication: "unpublished" })).toBeNull()
    expect(toPublicMediaRecord({ ...ASSET_ROW, state: "legacy_unverified", publication: "unpublished" })).toBeNull()
    expect(toPublicMediaRecord({ ...ASSET_ROW, state: "quarantined" })).toBeNull()
  })

  it("lets an operator inspect a non-deleted lifecycle state but never a deleted one", () => {
    expect(toPublicMediaRecord({ ...ASSET_ROW, state: "processing", publication: "unpublished" }, "operator"))
      .not.toBeNull()
    expect(toPublicMediaRecord({ ...ASSET_ROW, state: "deleted" }, "operator")).toBeNull()
  })
})

describe("ENH-07-01: tenant-scoped delivery read", () => {
  it("filters by BOTH tenant and asset id", async () => {
    const captured = selectRows([ASSET_ROW])
    const record = await findDeliverableMediaAsset({ tenantId: TENANT, assetId: ASSET })

    expect(record?.id).toBe(ASSET)
    expect(captured.limit).toBe(1)
    const params = dialect.sqlToQuery(captured.where as any).params
    expect(params).toContain(TENANT)
    expect(params).toContain(ASSET)
  })

  it("returns null for another tenant's asset instead of leaking it", async () => {
    const captured = selectRows([])
    await expect(findDeliverableMediaAsset({ tenantId: OTHER_TENANT, assetId: ASSET })).resolves.toBeNull()
    const params = dialect.sqlToQuery(captured.where as any).params
    expect(params).toContain(OTHER_TENANT)
    expect(params).not.toContain(TENANT)
  })

  it("validates ids before querying", async () => {
    selectRows([])
    await expect(findDeliverableMediaAsset({ tenantId: "nope", assetId: ASSET })).rejects.toThrow()
    await expect(findDeliverableMediaAsset({ tenantId: TENANT, assetId: "nope" })).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

describe("ENH-07-02: public delivery locator", () => {
  function selectJoinedRows(rows: unknown[]) {
    mocks.select.mockImplementation(() => {
      const chain: any = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
      }
      return chain
    })
  }

  const delivery = "https://res.cloudinary.com/demo/image/upload/v17/ssl_demo.png"

  it("returns the stored Cloudinary URL only for ready+published+active", async () => {
    selectJoinedRows([{
      state: "ready", publication: "published", tenantActive: true,
      metadata: { deliveryUrl: delivery },
    }])
    await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBe(delivery)
  })

  describe("private originals", () => {
    const privateRow = (overrides: Record<string, unknown> = {}) => ({
      state: "ready", publication: "published", tenantActive: true,
      kind: "image", format: "png", providerPublicId: "ssl_demo",
      metadata: { deliveryType: "authenticated" },
      ...overrides,
    })
    const env = { ...process.env }
    afterEach(() => { process.env = { ...env } })

    it("mints a short-lived signed URL only for a published asset", async () => {
      process.env.CLOUDINARY_CLOUD_NAME = "demo"
      process.env.CLOUDINARY_API_KEY = "key"
      process.env.CLOUDINARY_API_SECRET = "secret"
      selectJoinedRows([privateRow()])
      const url = new URL((await findPublishedMediaDeliveryUrl(ASSET))!)
      expect(url.origin + url.pathname).toBe("https://api.cloudinary.com/v1_1/demo/image/download")
      expect(url.searchParams.get("type")).toBe("authenticated")
      expect(url.searchParams.get("public_id")).toBe("ssl_demo")
      expect(Number(url.searchParams.get("expires_at")) - Number(url.searchParams.get("timestamp")))
        .toBeLessThanOrEqual(300)

      selectJoinedRows([privateRow({ publication: "unpublished" })])
      await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBeNull()
      selectJoinedRows([privateRow({ publication: "withdrawn" })])
      await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBeNull()
    })

    it("serves nothing when provider credentials are missing", async () => {
      delete process.env.CLOUDINARY_API_SECRET
      selectJoinedRows([privateRow()])
      await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBeNull()
    })
  })

  it("hides unpublished, quarantined and inactive-league assets", async () => {
    selectJoinedRows([{
      state: "ready", publication: "unpublished", tenantActive: true,
      metadata: { deliveryUrl: delivery },
    }])
    await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBeNull()

    selectJoinedRows([{
      state: "quarantined", publication: "published", tenantActive: true,
      metadata: { deliveryUrl: delivery },
    }])
    await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBeNull()

    selectJoinedRows([{
      state: "ready", publication: "published", tenantActive: false,
      metadata: { deliveryUrl: delivery },
    }])
    await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBeNull()
  })

  it("refuses a missing row or a non-Cloudinary/credentialed URL", async () => {
    selectJoinedRows([])
    await expect(findPublishedMediaDeliveryUrl(ASSET)).resolves.toBeNull()

    for (const deliveryUrl of [
      "http://res.cloudinary.com/demo/image.png",
      "https://evil.example/demo.png",
      "data:image/png;base64,AAAA",
      "https://user:pass@res.cloudinary.com/demo/image.png",
      "https://res.cloudinary.com/",
    ]) {
      expect(cloudinaryDeliveryUrl({ deliveryUrl })).toBeNull()
    }
  })

  it("strips fragments and keeps the provider path", () => {
    expect(cloudinaryDeliveryUrl({
      deliveryUrl: `${delivery}#fragment`,
    })).toBe(delivery)
  })
})

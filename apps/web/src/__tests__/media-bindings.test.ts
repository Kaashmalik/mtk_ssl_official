import { beforeEach, describe, expect, it, vi } from "vitest"
import { auditLogs, mediaBindings } from "@mtk/database"
import { bindMediaAsset, unbindMediaAsset } from "@/lib/media-bindings"
import { MediaAuthorizationError } from "@/lib/media-authorization"

/**
 * ENH-07-04: resource attachment.
 *
 * Binding is scoped, same-tenant and ready-only. A duplicate is idempotent;
 * a foreign/quarantined asset or an implausible role never creates a row.
 */

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  assertResource: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/media-authorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/media-authorization")>(),
  requireMediaActor: mocks.requireActor,
  assertMediaResourceAccess: mocks.assertResource,
}))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select, transaction: mocks.transaction },
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const ACTOR = "00000000-0000-4000-8000-0000000000b1"
const ASSET = "00000000-0000-4000-8000-0000000000c1"
const TEAM = "00000000-0000-4000-8000-0000000000d1"
const BINDING = "00000000-0000-4000-8000-0000000000e1"

const ACTOR_CTX = { tenantId: TENANT, actorId: ACTOR, clerkId: "clerk_1", role: "league_owner" as const }

function readRows(rows: unknown[]) {
  mocks.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  })
}

function fakeTx(options: {
  selectQueue?: unknown[][]
  insertRows?: unknown[]
  deleteRows?: unknown[]
} = {}) {
  const queue = [...(options.selectQueue ?? [])]
  const inserts: { table: unknown; values: any }[] = []
  const tx = {
    select() {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        for: () => chain,
        limit: async () => queue.shift() ?? [],
      }
      return chain
    },
    insert(table: unknown) {
      return {
        values(values: any) {
          inserts.push({ table, values })
          return Object.assign(Promise.resolve(undefined), {
            onConflictDoNothing: () => ({
              returning: async () => options.insertRows ?? [],
            }),
            returning: async () => options.insertRows ?? [],
          })
        },
      }
    },
    delete() {
      return {
        where: () => ({
          returning: async () => options.deleteRows ?? [],
        }),
      }
    },
  }
  return { tx: tx as any, inserts }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireActor.mockResolvedValue(ACTOR_CTX)
  mocks.assertResource.mockResolvedValue(undefined)
})

describe("ENH-07-04: bind verified media", () => {
  it("binds a ready same-tenant asset and audits it", async () => {
    const { tx, inserts } = fakeTx({
      selectQueue: [[{ id: ASSET, tenantId: TENANT, state: "ready" }]],
      insertRows: [{ id: BINDING }],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    const result = await bindMediaAsset(ASSET, {
      bindingType: "team", resourceId: TEAM, role: "logo",
    })
    expect(result).toEqual({
      ok: true, bindingId: BINDING, assetId: ASSET, created: true,
    })
    expect(inserts.find(row => row.table === mediaBindings)?.values)
      .toMatchObject({
        tenantId: TENANT, assetId: ASSET, resourceType: "team",
        resourceId: TEAM, role: "logo", createdBy: ACTOR,
      })
    expect(inserts.find(row => row.table === auditLogs)?.values)
      .toMatchObject({ method: "MEDIA_ASSET_BOUND" })
  })

  it("treats an exact duplicate as idempotent without a second audit", async () => {
    const { tx, inserts } = fakeTx({
      selectQueue: [
        [{ id: ASSET, tenantId: TENANT, state: "ready" }],
        [{ id: BINDING }],
      ],
      insertRows: [],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    await expect(bindMediaAsset(ASSET, {
      bindingType: "team", resourceId: TEAM, role: "logo",
    })).resolves.toEqual({
      ok: true, bindingId: BINDING, assetId: ASSET, created: false,
    })
    expect(inserts.some(row => row.table === auditLogs)).toBe(false)
  })

  it("refuses an implausible role before authorizing", async () => {
    await expect(bindMediaAsset(ASSET, {
      bindingType: "match", resourceId: TEAM, role: "logo",
    })).resolves.toEqual({ ok: false, reason: "role_not_allowed" })
    expect(mocks.requireActor).not.toHaveBeenCalled()
  })

  it("refuses a foreign asset and a non-ready asset", async () => {
    const foreign = fakeTx({ selectQueue: [[]] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(foreign.tx))
    await expect(bindMediaAsset(ASSET, {
      bindingType: "team", resourceId: TEAM, role: "logo",
    })).resolves.toEqual({ ok: false, reason: "not_found" })

    const quarantined = fakeTx({
      selectQueue: [[{ id: ASSET, tenantId: TENANT, state: "quarantined" }]],
    })
    mocks.transaction.mockImplementation(async (cb: any) => cb(quarantined.tx))
    await expect(bindMediaAsset(ASSET, {
      bindingType: "team", resourceId: TEAM, role: "logo",
    })).resolves.toEqual({ ok: false, reason: "asset_quarantined" })
  })

  it("composes the class permission and resource grant", async () => {
    mocks.requireActor.mockRejectedValue(new MediaAuthorizationError("permission_denied"))
    await expect(bindMediaAsset(ASSET, {
      bindingType: "branding", resourceId: TENANT, role: "logo",
    })).rejects.toMatchObject({ code: "permission_denied" })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("ENH-07-04: unbind media", () => {
  const row = {
    id: BINDING, tenantId: TENANT, assetId: ASSET,
    resourceType: "team", resourceId: TEAM,
  }

  it("removes one same-tenant binding and audits it", async () => {
    readRows([row])
    const { tx, inserts } = fakeTx({ deleteRows: [{ id: BINDING }] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))

    await expect(unbindMediaAsset({ assetId: ASSET, bindingId: BINDING })).resolves.toEqual({
      ok: true, bindingId: BINDING,
    })
    expect(mocks.requireActor).toHaveBeenCalledWith("team")
    expect(mocks.assertResource).toHaveBeenCalledWith(expect.objectContaining({
      bindingType: "team", resourceId: TEAM,
    }))
    expect(inserts.find(row => row.table === auditLogs)?.values)
      .toMatchObject({ method: "MEDIA_ASSET_UNBOUND" })
  })

  it("returns not-found for a binding outside the actor's tenant", async () => {
    readRows([{ ...row, tenantId: "00000000-0000-4000-8000-0000000000ff" }])
    await expect(unbindMediaAsset({ assetId: ASSET, bindingId: BINDING })).resolves.toEqual({
      ok: false, reason: "not_found",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("returns not-found when the binding was already removed", async () => {
    readRows([row])
    const { tx } = fakeTx({ deleteRows: [] })
    mocks.transaction.mockImplementation(async (cb: any) => cb(tx))
    await expect(unbindMediaAsset({ assetId: ASSET, bindingId: BINDING })).resolves.toEqual({
      ok: false, reason: "not_found",
    })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { assignScorer, getScorersForTenant } from "@/app/actions/matches"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), tenant: vi.fn(),
  where: vi.fn(), limit: vi.fn(), updateWhere: vi.fn(), returning: vi.fn(), context: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, resolveActiveTenantId: mocks.tenant }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: vi.fn(() => { throw new Error("Must use active tenant") }) }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  withTenantContext: mocks.context,
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.where })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: mocks.updateWhere })) })),
  },
}))
const MATCH = "00000000-0000-4000-8000-000000000001"
const SCORER = "00000000-0000-4000-8000-000000000002"
const TENANT = "00000000-0000-4000-8000-000000000003"
describe("Tenant-safe scorer assignment", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: "clerk" })
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.permission.mockResolvedValue(undefined)
    mocks.context.mockImplementation(async (_context, run) => run())
    mocks.where.mockReturnValue({ limit: mocks.limit })
    mocks.limit.mockResolvedValue([{ id: SCORER }])
    mocks.updateWhere.mockReturnValue({ returning: mocks.returning })
    mocks.returning.mockResolvedValue([{ id: MATCH }])
  })
  it("authorizes and updates the exact active tenant", async () => {
    await assignScorer(MATCH, SCORER)
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
    expect(mocks.context).toHaveBeenCalledWith({ userId: "clerk", tenantId: TENANT }, expect.any(Function))
    const dialect = new PgDialect()
    const candidate = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(candidate.params).toEqual([SCORER, TENANT])
    expect(candidate.sql).toContain('"status" = \'active\'')
    expect(candidate.sql).toContain('"users"."is_active" = true')
    expect(candidate.sql).not.toContain("NOT EXISTS")
    expect(dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0]).params).toEqual([MATCH, TENANT])
  })
  it("rejects a scorer who does not belong to the tenant before updating", async () => {
    mocks.limit.mockResolvedValue([])
    await expect(assignScorer(MATCH, SCORER)).rejects.toThrow("scorer in this tenant")
    expect(mocks.updateWhere).not.toHaveBeenCalled()
  })
  it("allows explicit unassignment without selecting a candidate", async () => {
    await assignScorer(MATCH, null)
    expect(mocks.where).not.toHaveBeenCalled()
    expect(mocks.updateWhere).toHaveBeenCalledOnce()
  })
  it("rejects malformed assignment IDs", async () => {
    await expect(assignScorer(MATCH, "bad-id")).rejects.toThrow()
    expect(mocks.updateWhere).not.toHaveBeenCalled()
  })
  it("lists scorers using the same tenant membership contract as assignment", async () => {
    mocks.where.mockResolvedValue([])
    await getScorersForTenant()
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([TENANT])
  })
})

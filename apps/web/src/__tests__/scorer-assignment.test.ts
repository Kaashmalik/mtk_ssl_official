import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { assignScorer, getScorersForTenant } from "@/app/actions/matches"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), tenant: vi.fn(),
  where: vi.fn(), limit: vi.fn(), set: vi.fn(), updateWhere: vi.fn(), returning: vi.fn(), context: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, resolveActiveTenantId: mocks.tenant }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: vi.fn(() => { throw new Error("Must use active tenant") }) }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  withTenantContext: mocks.context,
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.where })) })),
    update: vi.fn(() => ({ set: mocks.set })),
  },
}))
const MATCH = "00000000-0000-4000-8000-000000000001"
const SCORER = "00000000-0000-4000-8000-000000000002"
const BACKUP = "00000000-0000-4000-8000-000000000004"
const TENANT = "00000000-0000-4000-8000-000000000003"
const dialect = new PgDialect()
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.context.mockImplementation(async (_context, run) => run())
  mocks.where.mockReturnValue({ limit: mocks.limit })
  // First limit() resolves the existing match; later ones resolve a scorer candidate.
  mocks.limit.mockResolvedValueOnce([{ id: MATCH, scorerId: null, backupScorerId: null }]).mockResolvedValue([{ id: SCORER }])
  mocks.set.mockReturnValue({ where: mocks.updateWhere })
  mocks.updateWhere.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockResolvedValue([{ id: MATCH }])
})
describe("Tenant-safe primary/backup scorer assignment", () => {
  it("authorizes and sets the primary slot on the exact active tenant", async () => {
    await assignScorer(MATCH, "primary", SCORER)
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
    expect(mocks.context).toHaveBeenCalledWith({ userId: "clerk", tenantId: TENANT }, expect.any(Function))
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([MATCH, TENANT])
    const candidate = dialect.sqlToQuery(mocks.where.mock.calls[1][0])
    expect(candidate.params).toEqual([SCORER, TENANT])
    expect(candidate.sql).toContain('"status" = \'active\'')
    expect(candidate.sql).toContain('"users"."is_active" = true')
    expect(candidate.sql).not.toContain("NOT EXISTS")
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ scorerId: SCORER }))
    expect(dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0]).params).toEqual([MATCH, TENANT])
  })
  it("sets the backup slot without touching the primary", async () => {
    await assignScorer(MATCH, "backup", BACKUP)
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ backupScorerId: BACKUP }))
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("scorerId")
  })
  it("rejects placing the same person in both slots", async () => {
    mocks.limit.mockReset().mockResolvedValueOnce([{ id: MATCH, scorerId: SCORER, backupScorerId: null }]).mockResolvedValue([{ id: SCORER }])
    await expect(assignScorer(MATCH, "backup", SCORER)).rejects.toThrow("different people")
    expect(mocks.updateWhere).not.toHaveBeenCalled()
  })
  it("rejects a scorer who does not belong to the tenant before updating", async () => {
    mocks.limit.mockReset().mockResolvedValueOnce([{ id: MATCH, scorerId: null, backupScorerId: null }]).mockResolvedValue([])
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("scorer in this tenant")
    expect(mocks.updateWhere).not.toHaveBeenCalled()
  })
  it("rejects a match outside the active tenant", async () => {
    mocks.limit.mockReset().mockResolvedValueOnce([])
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("Match not found")
    expect(mocks.updateWhere).not.toHaveBeenCalled()
  })
  it("allows clearing either slot without selecting a candidate", async () => {
    await assignScorer(MATCH, "backup", null)
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ backupScorerId: null }))
    expect(mocks.where).toHaveBeenCalledTimes(1) // only the existing-match lookup
    expect(mocks.updateWhere).toHaveBeenCalledOnce()
  })
  it.each(["primary", "backup"])("rejects malformed assignment IDs for %s", async slot => {
    await expect(assignScorer(MATCH, slot as never, "bad-id")).rejects.toThrow()
    expect(mocks.updateWhere).not.toHaveBeenCalled()
  })
  it("rejects an unknown slot before any query", async () => {
    await expect(assignScorer(MATCH, "tertiary" as never, SCORER)).rejects.toThrow()
    expect(mocks.where).not.toHaveBeenCalled()
  })
  it("lists scorers using the same tenant membership contract as assignment", async () => {
    mocks.where.mockResolvedValue([])
    await getScorersForTenant()
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([TENANT])
  })
})

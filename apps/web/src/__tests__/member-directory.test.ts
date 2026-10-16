import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { userTenantRoles } from "@mtk/database"
import { readMemberDirectory, readMemberDetails } from "@/lib/member-directory"
import { MEMBER_DIRECTORY_PAGE_SIZE, memberDirectoryFilters, memberDirectoryHref, parseMemberDirectorySearch } from "@/lib/member-directory-filters"

const mocks = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), join: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), order: vi.fn(), limit: vi.fn() }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select } }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const MEMBER = "00000000-0000-4000-8000-000000000002"
const dialect = new PgDialect()

beforeEach(() => {
  vi.resetAllMocks()
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.join })
  mocks.join.mockReturnValue({ leftJoin: mocks.leftJoin, where: mocks.where })
  mocks.leftJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ orderBy: mocks.order, limit: mocks.limit })
  mocks.order.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockResolvedValue([])
})

describe("Member directory filter and navigation contracts", () => {
  it("uses bounded defaults and normalizes search whitespace", () => {
    expect(memberDirectoryFilters.parse({})).toEqual({ q: "", role: "all", status: "all", expiry: "all" })
    expect(parseMemberDirectorySearch({ q: " Ali " })).toMatchObject({ success: true, data: { q: "Ali" } })
  })
  it.each([{ q: "a".repeat(101) }, { q: ["Ali", "Bob"] }, { status: "disabled" }, { role: "admin" }, { expiry: "forever" }, { after: "invalid" }, { after: [MEMBER, MEMBER] }])("rejects invalid filters %s", input => {
    expect(parseMemberDirectorySearch(input).success).toBe(false)
  })
  it("preserves filters in next links while first-page links discard the cursor", () => {
    const filters = memberDirectoryFilters.parse({ q: "A&B + ?", role: "scorer", status: "active", expiry: "expired", after: MEMBER })
    const next = new URL(memberDirectoryHref(filters, TENANT), "https://example.test")
    expect(next.pathname).toBe("/dashboard/settings/members")
    expect(next.searchParams.get("q")).toBe("A&B + ?")
    expect(next.searchParams.get("after")).toBe(TENANT)
    expect(next.searchParams.get("role")).toBe("scorer")
    expect(next.searchParams.get("status")).toBe("active")
    expect(next.searchParams.get("expiry")).toBe("expired")
    expect(new URL(memberDirectoryHref(filters), next).searchParams.has("after")).toBe(false)
  })
})

describe("Member directory reads (mocked SQL, not RLS acceptance)", () => {
  it("scopes the first page by league, orders by immutable unique ID and fetches a sentinel", async () => {
    expect(await readMemberDirectory(TENANT)).toEqual({ members: [], nextCursor: null })
    expect(mocks.from).toHaveBeenCalledWith(userTenantRoles)
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([TENANT])
    expect(mocks.order).toHaveBeenCalledWith(userTenantRoles.id)
    expect(mocks.limit).toHaveBeenCalledWith(MEMBER_DIRECTORY_PAGE_SIZE + 1)
    expect(Object.keys(mocks.select.mock.calls[0][0])).not.toContain("tenantIds")
    expect(Object.keys(mocks.select.mock.calls[0][0])).not.toContain("clerkId")
  })
  it("applies the cursor, status, role and literal search to the same league query", async () => {
    await readMemberDirectory(TENANT, { after: MEMBER, status: "suspended", role: "scorer", q: "100%_\\" })
    const where = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(where.params).toEqual([TENANT, MEMBER, "suspended", "scorer", "%100\\%\\_\\\\%", "%100\\%\\_\\\\%"])
    expect(where.sql).toContain('"user_tenant_roles"."id" >')
    expect(where.sql).toContain('"user_tenant_roles"."role" =')
    expect(where.sql).toContain(" ilike ")
  })
  it("returns 50 members and the last listed ID as cursor, not the sentinel ID", async () => {
    const rows = Array.from({ length: MEMBER_DIRECTORY_PAGE_SIZE + 1 }, (_, index) => ({ membershipId: `member-${index}` }))
    mocks.limit.mockResolvedValue(rows)
    const result = await readMemberDirectory(TENANT)
    expect(result.members).toHaveLength(MEMBER_DIRECTORY_PAGE_SIZE)
    expect(result.nextCursor).toBe("member-49")
  })
  it("binds hostile search text as a parameter, not SQL", async () => {
    const text = "x' OR 1=1 --"
    await readMemberDirectory(TENANT, { q: text })
    const where = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(where.params).toEqual([TENANT, `%${text}%`, `%${text}%`])
    expect(where.sql).not.toContain(text)
  })
  it("has no next page at the exact page-size boundary", async () => {
    mocks.limit.mockResolvedValue(Array.from({ length: MEMBER_DIRECTORY_PAGE_SIZE }, () => ({ membershipId: MEMBER })))
    expect((await readMemberDirectory(TENANT)).nextCursor).toBeNull()
  })
  it("rejects an invalid tenant before querying", async () => {
    await expect(readMemberDirectory("invalid")).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("rejects invalid library filters even if the URL parser was skipped", async () => {
    await expect(readMemberDirectory(TENANT, { role: "admin" } as never)).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("reads member detail by exact league and membership ID with a minimal field allowlist", async () => {
    mocks.limit.mockResolvedValue([{ membershipId: MEMBER, email: "ali@example.test" }])
    expect(await readMemberDetails(TENANT, MEMBER)).toMatchObject({ membershipId: MEMBER })
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([TENANT, MEMBER])
    expect(mocks.limit).toHaveBeenCalledWith(1)
  })
  it("returns null for missing/foreign member detail", async () => {
    expect(await readMemberDetails(TENANT, MEMBER)).toBeNull()
  })
  it("rejects malformed detail IDs before querying", async () => {
    await expect(readMemberDetails(TENANT, "invalid")).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("does not turn a query outage into an empty directory or missing member", async () => {
    mocks.limit.mockRejectedValue(new Error("Database unavailable"))
    await expect(readMemberDirectory(TENANT)).rejects.toThrow("Database unavailable")
    await expect(readMemberDetails(TENANT, MEMBER)).rejects.toThrow("Database unavailable")
  })

  it.each([
    ["unbounded", '"user_tenant_roles"."expires_at" is null', [TENANT]],
    ["expired", '"user_tenant_roles"."expires_at" <= now()', [TENANT]],
  ] as const)("applies the %s expiry filter against the database clock", async (expiry, fragment, params) => {
    await readMemberDirectory(TENANT, { expiry })
    const where = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(where.sql).toContain(fragment)
    expect(where.params).toEqual(params)
  })

  it("applies the bounded expiry filter without a clock comparison", async () => {
    await readMemberDirectory(TENANT, { expiry: "bounded" })
    const where = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(where.sql).toContain('"user_tenant_roles"."expires_at" is not null')
    expect(where.sql).not.toContain("now()")
    expect(where.params).toEqual([TENANT])
  })

  it("reads expiry state in directory rows and provenance in member detail", async () => {
    await readMemberDirectory(TENANT)
    expect(Object.keys(mocks.select.mock.calls[0][0])).toContain("expiresAt")
    expect(Object.keys(mocks.select.mock.calls[0][0])).not.toContain("delegatedByName")

    mocks.limit.mockResolvedValue([{ membershipId: MEMBER, expiresAt: null, delegatedByUserId: null, delegatedByName: null }])
    const detail = await readMemberDetails(TENANT, MEMBER)
    expect(detail).toMatchObject({ membershipId: MEMBER })
    const detailKeys = Object.keys(mocks.select.mock.calls.at(-1)![0])
    expect(detailKeys).toContain("delegatedByUserId")
    expect(detailKeys).toContain("delegatedByName")
    // Provenance join reaches the aliased users table, still tenant-scoped by parameters.
    expect(mocks.leftJoin).toHaveBeenCalledTimes(1)
    expect(dialect.sqlToQuery(mocks.where.mock.calls.at(-1)![0]).params).toEqual([TENANT, MEMBER])
  })
})

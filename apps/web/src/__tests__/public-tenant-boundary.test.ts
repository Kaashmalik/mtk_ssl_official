import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getPublicTenantContext } from "@/lib/public-tenant"

const mocks = vi.hoisted(() => ({ headers: vi.fn(), select: vi.fn(), from: vi.fn(), where: vi.fn(), limit: vi.fn() }))
vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select } }))
const dialect = new PgDialect()

beforeEach(() => {
  vi.resetAllMocks()
  mocks.headers.mockResolvedValue({ get: (key: string) => key === "host" ? "club.example.test" : null })
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockResolvedValue([])
})

describe("Public host tenant activity boundary (mocked SQL)", () => {
  it("requires active status across custom-domain as well as slug alternatives", async () => {
    await getPublicTenantContext()
    const query = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(query.sql).toMatch(/^\("tenants"\."is_active" = \$1 and /)
    expect(query.params[0]).toBe(true)
    expect(query.sql).toContain('"tenants"."custom_domain_verified"')
    expect(query.sql).toContain('"tenants"."ssl_enabled"')
    expect(mocks.limit).toHaveBeenCalledWith(3)
  })
  it("returns no context without a matching active host league", async () => {
    expect(await getPublicTenantContext()).toBeNull()
  })
  it("does not replace an outage with a default/global league", async () => {
    mocks.limit.mockRejectedValue(new Error("Database unavailable"))
    await expect(getPublicTenantContext()).rejects.toThrow("Database unavailable")
  })
})

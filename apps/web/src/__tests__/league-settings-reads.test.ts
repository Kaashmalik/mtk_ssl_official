import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { tenants, tenantBranding, invoices, whiteLabelRequests } from "@mtk/database"
import {
  readInvoice, readInvoices, readLeagueBranding, readLeagueIdentity, readLeagueSettings, readWhiteLabelRequests,
} from "@/lib/league-settings-reads"

const mocks = vi.hoisted(() => ({ select: vi.fn(), queries: [] as any[], state: {} as any }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000ff"
const INVOICE = "00000000-0000-4000-8000-000000000003"
const REQUEST = "00000000-0000-4000-8000-000000000004"
const dialect = new PgDialect()

function rowsFor(record: any) {
  if (record.table === tenants) return mocks.state.tenants
  if (record.table === tenantBranding) return mocks.state.branding
  if (record.table === invoices) return mocks.state.invoices
  if (record.table === whiteLabelRequests) return mocks.state.whiteLabel
  return []
}

function selectChain() {
  const record: any = { params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
    orderBy: () => chain,
    limit: (limit: number) => { record.limit = limit; return chain },
    then: (resolve: any, reject: any) => Promise.resolve(rowsFor(record)).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = {
    tenants: [{ id: TENANT, name: "Premier League", slug: "premier", plan: "pro" }],
    branding: [{ appName: "Premier", logoUrl: null, faviconUrl: null, primaryColor: null, secondaryColor: null, accentColor: null }],
    invoices: [{ id: INVOICE, invoiceNumber: "SSL-INV-2026-000001", plan: "pro", status: "paid",
      total: "1999.00", currency: "PKR", paidAt: null, createdAt: new Date("2026-01-01") }],
    whiteLabel: [{ id: REQUEST, status: "pending", customDomain: null, hideBranding: true,
      customAppName: null, adminNotes: null, createdAt: new Date("2026-01-02") }],
  }
  mocks.select.mockImplementation(selectChain)
})

describe("Settings/billing reads are scoped to the exact active league", () => {
  it("predicates every read on the active league and never the caller's other leagues", async () => {
    await readLeagueSettings(TENANT)
    await readInvoices(TENANT)
    await readInvoice(TENANT, INVOICE)
    await readWhiteLabelRequests(TENANT)
    expect(mocks.queries.length).toBe(5)
    for (const query of mocks.queries) {
      expect(query.params).toContain(TENANT)
      expect(query.params).not.toContain(OTHER_TENANT)
    }
    const identity = mocks.queries.find((query) => query.table === tenants)!
    expect(identity.params).toEqual([TENANT, true])
    const invoice = mocks.queries.find((query) => query.table === invoices && query.params.includes(INVOICE))!
    expect(invoice.params).toEqual([INVOICE, TENANT])
  })

  it("returns a minimal projection, never the whole tenant row", async () => {
    const identity = await readLeagueIdentity(TENANT)
    expect(identity).toEqual({ id: TENANT, name: "Premier League", slug: "premier", plan: "pro" })
    expect(Object.keys(identity).sort()).toEqual(["id", "name", "plan", "slug"])
  })

  it("treats a missing or inactive league as a hard failure, not an empty identity", async () => {
    mocks.state.tenants = []
    await expect(readLeagueIdentity(TENANT)).rejects.toThrow("League not found")
  })

  it("combines identity and branding, and reports absent branding as null", async () => {
    const settings = await readLeagueSettings(TENANT)
    expect(settings.tenant.name).toBe("Premier League")
    expect(settings.branding?.appName).toBe("Premier")
    mocks.state.branding = []
    await expect(readLeagueBranding(TENANT)).resolves.toBeNull()
    expect((await readLeagueSettings(TENANT)).branding).toBeNull()
  })

  it("bounds the invoice history and the white-label request history", async () => {
    await readInvoices(TENANT)
    await readWhiteLabelRequests(TENANT)
    const invoiceQuery = mocks.queries.find((query) => query.table === invoices)!
    const requestQuery = mocks.queries.find((query) => query.table === whiteLabelRequests)!
    expect(invoiceQuery.limit).toBe(50)
    expect(requestQuery.limit).toBe(10)
  })

  it("rejects a non-uuid invoice id before any query", async () => {
    await expect(readInvoice(TENANT, "not-a-uuid")).rejects.toThrow()
    expect(mocks.queries).toHaveLength(0)
  })

  it("returns null for an invoice that belongs to another league", async () => {
    mocks.state.invoices = []
    await expect(readInvoice(TENANT, INVOICE)).resolves.toBeNull()
  })

  it("never returns more rows than the caller's bound", async () => {
    await expect(readInvoices(TENANT, 10_000)).rejects.toThrow()
    expect(mocks.queries).toHaveLength(0)
  })
})

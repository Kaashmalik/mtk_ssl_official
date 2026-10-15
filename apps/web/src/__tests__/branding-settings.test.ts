import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { brandingPlanViolation, getBrandingSettings, saveBrandingSettings } from "@/lib/branding-settings"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  state: {
    selectResults: [] as unknown[][],
    updateResults: [] as unknown[][],
    records: [] as unknown[],
  },
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, update: mocks.update, insert: mocks.insert, transaction: mocks.transaction },
}))

const dialect = new PgDialect()

interface QueryRecord {
  kind: "select" | "update" | "insert" | "execute"
  params?: unknown[]
  setValues?: Record<string, unknown>
  values?: Record<string, unknown>
  result?: unknown[]
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.selectResults = []
  mocks.state.updateResults = []
  mocks.state.records = []
  mocks.select.mockImplementation(() => {
    const record: QueryRecord = { kind: "select", params: [] }
    mocks.state.records.push(record)
    const chain: any = {
      from: () => chain,
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      for: () => chain,
      limit: () => Promise.resolve(mocks.state.selectResults.shift() ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(mocks.state.selectResults.shift() ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.update.mockImplementation(() => {
    const record: QueryRecord = { kind: "update", params: [], result: mocks.state.updateResults.shift() ?? [] }
    mocks.state.records.push(record)
    const chain: any = {
      set: (values: any) => { record.setValues = values; return chain },
      where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
      returning: () => Promise.resolve(record.result ?? []),
      then: (resolve: any, reject: any) => Promise.resolve(record.result ?? []).then(resolve, reject),
    }
    return chain
  })
  mocks.insert.mockImplementation(() => {
    const record: QueryRecord = { kind: "insert", values: undefined }
    mocks.state.records.push(record)
    const chain: any = {
      values: (values: any) => { record.values = values; return { returning: () => Promise.resolve([]) } },
      then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
    }
    return chain
  })
  mocks.execute.mockImplementation(async (query: any) => {
    const converted = dialect.sqlToQuery(query)
    mocks.state.records.push({ kind: "execute", params: converted.params, sql: converted.sql } as QueryRecord)
    return []
  })
  mocks.transaction.mockImplementation(async (fn: any) => fn(mocks))
})

const queryRecords = () => mocks.state.records as QueryRecord[]
const TENANT = "00000000-0000-4000-8000-000000000010"

describe("branding plan gating", () => {
  it("reserves white-label fields for pro and up", () => {
    for (const field of ["fontFamily", "mobileAppBundleId"] as const) {
      expect(brandingPlanViolation("free", { [field]: "custom" })).toContain("White-label customization")
      expect(brandingPlanViolation("pro", { [field]: "custom" })).toBeNull()
    }
  })

  it("treats unset / falsy white-label fields as not requested", () => {
    expect(brandingPlanViolation("free", {})).toBeNull()
    expect(brandingPlanViolation("free", { hideSslBranding: false })).toBeNull()
    expect(brandingPlanViolation("free", { fontFamily: null })).toBeNull()
  })

  it("reserves custom domains for enterprise only", () => {
    expect(brandingPlanViolation("free", { customDomain: "ssl.example" })).toContain("Custom domains require Enterprise")
    expect(brandingPlanViolation("pro", { customDomain: "ssl.example" })).toContain("Custom domains require Enterprise")
    expect(brandingPlanViolation("enterprise", { customDomain: "ssl.example" })).toBeNull()
  })
})

describe("branding reads", () => {
  it("returns the tenant and its branding row (null when absent)", async () => {
    mocks.state.selectResults = [[{ id: TENANT, customDomain: "x.example" }], [{ tenantId: TENANT, appName: "MyApp" }]]
    const result = await getBrandingSettings(TENANT)
    expect("branding" in result && result.branding?.appName).toBe("MyApp")
  })

  it("answers missing when the tenant does not exist", async () => {
    mocks.state.selectResults = [[]]
    expect(await getBrandingSettings(TENANT)).toEqual({ missing: true })
    expect(mocks.select).toHaveBeenCalledTimes(1) // branding row never queried
  })
})

describe("branding writes are tenant-locked and plan-gated", () => {
  const data = { logoUrl: "https://cdn.example/logo.png", hideSslBranding: true }

  it("answers missing without any write when the tenant does not exist", async () => {
    mocks.state.selectResults = [[]]
    expect(await saveBrandingSettings({ tenantId: TENANT, data })).toEqual({ missing: true })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("rejects gated fields against the plan read under the lock, before any write", async () => {
    mocks.state.selectResults = [[{ id: TENANT, plan: "free" }]]
    const result = await saveBrandingSettings({ tenantId: TENANT, data })
    expect("violation" in result && result.violation).toContain("hideSslBranding")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("inserts branding and the custom domain when none exists yet", async () => {
    mocks.state.selectResults = [[{ id: TENANT, plan: "enterprise" }], []] // tenant, no branding row
    expect(await saveBrandingSettings({ tenantId: TENANT, data: { ...data, customDomain: "x.example" } })).toEqual({ ok: true })

    const [lock, tenantRead, domainUpdate, , insert] = queryRecords()
    expect(lock.kind).toBe("execute") // tenant row locked FOR UPDATE
    expect(String(lock.params)).toContain(TENANT)
    expect(tenantRead.kind).toBe("select")
    expect(domainUpdate.setValues).toEqual({ customDomain: "x.example" })
    expect(mocks.update).toHaveBeenCalledTimes(1) // only the domain; branding goes through insert
    expect(insert.values).toMatchObject({ tenantId: TENANT, logoUrl: "https://cdn.example/logo.png", hideSslBranding: true })
  })

  it("updates the existing branding row instead of inserting a duplicate", async () => {
    mocks.state.selectResults = [[{ id: TENANT, plan: "pro" }], [{ tenantId: TENANT }]]
    expect(await saveBrandingSettings({ tenantId: TENANT, data })).toEqual({ ok: true })

    const inserts = queryRecords().filter((r) => r.kind === "insert")
    expect(inserts).toHaveLength(0)
    const updates = queryRecords().filter((r) => r.kind === "update")
    expect(updates[0].setValues).toMatchObject({ logoUrl: "https://cdn.example/logo.png" })
  })
})

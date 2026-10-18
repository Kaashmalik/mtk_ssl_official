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

// PREM-02 (Batch 135): Brand Studio draft -> publish -> rollback. The same
// tenant-lock + plan-gate discipline as the direct writer; publish consumes
// the draft; rollback swaps the snapshot pair; replays answer honestly.
import {
  activeBrandingSnapshot,
  publishBrandingDraft,
  rollbackBranding,
  saveBrandingDraft,
} from "@/lib/branding-settings"

describe("Brand Studio draft saves are tenant-locked and plan-gated (Batch 135)", () => {
  const data = { primaryColor: "#123456", fontFamily: "Inter" }

  it("rejects gated draft fields against the plan read under the lock, before any write", async () => {
    mocks.state.selectResults = [[{ id: TENANT, plan: "free" }]]
    const result = await saveBrandingDraft({ tenantId: TENANT, data: { fontFamily: "Inter" } })
    expect("violation" in result && result.violation).toContain("White-label")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("answers missing without any write when the tenant does not exist", async () => {
    mocks.state.selectResults = [[]]
    expect(await saveBrandingDraft({ tenantId: TENANT, data })).toEqual({ missing: true })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("inserts the draft and an audit row when no branding row exists", async () => {
    mocks.state.selectResults = [[{ id: TENANT, plan: "pro" }], []]
    const result = await saveBrandingDraft({ tenantId: TENANT, data })
    expect("ok" in result && result.ok).toBe(true)
    expect("draft" in result && result.draft?.primaryColor).toBe("#123456")
    expect("draft" in result && result.draft?.fontFamily).toBe("Inter")

    const [lock, tenantRead, , draftInsert, auditInsert] = queryRecords()
    expect(lock.kind).toBe("execute") // tenant row locked FOR UPDATE
    expect(tenantRead.kind).toBe("select")
    expect(draftInsert.values).toMatchObject({ tenantId: TENANT, draft: { primaryColor: "#123456", fontFamily: "Inter" } })
    expect(auditInsert.values).toMatchObject({ tenantId: TENANT, method: "BRAND_DRAFT_SAVED" })
   })

  it("retargets the existing draft without publishing it", async () => {
    mocks.state.selectResults = [[{ id: TENANT, plan: "pro" }], [{ tenantId: TENANT, published: { primaryColor: "#000000" } }]]
    await saveBrandingDraft({ tenantId: TENANT, data: { primaryColor: "#ffffff" } })
    const updates = queryRecords().filter((r) => r.kind === "update")
    expect(mocks.update).toHaveBeenCalled()
    expect(updates[0].setValues).toMatchObject({ draft: { primaryColor: "#ffffff" } })
    expect(updates[0].setValues).not.toHaveProperty("published")
  })

  it("a draft save never changes the active published snapshot", async () => {
    const published = { primaryColor: "#000000" }
    mocks.state.selectResults = [[{ id: TENANT, plan: "pro" }], [{ tenantId: TENANT, published }]]
    await saveBrandingDraft({ tenantId: TENANT, data: { primaryColor: "#ffffff" } })
    const updates = queryRecords().filter((r) => r.kind === "update")
    expect(updates[0].setValues?.published).toBeUndefined()
  })
})

describe("Brand Studio publish consumes the draft (Batch 135)", () => {
  const draft = { primaryColor: "#123456", appName: "Studios" }
  const previouslyPublished = { primaryColor: "#000000", appName: "Legacy" }

  it("moves the draft into published, keeps the previous snapshot and audits under the lock", async () => {
    mocks.state.selectResults = [[{ tenantId: TENANT, draft, published: previouslyPublished, previousPublished: null }]]
    const result = await publishBrandingDraft({ tenantId: TENANT })
    expect(result).toEqual({ ok: true, published: draft })

    const [lock, rowRead, publishUpdate] = queryRecords().filter((r) => r.kind === "execute" || r.kind === "select" || r.kind === "update")
    expect(lock.kind).toBe("execute")
    expect(rowRead.kind).toBe("select")
    expect(publishUpdate.setValues).toMatchObject({
      published: draft,
      previousPublished: previouslyPublished,
      draft: null,
    })
    expect(publishUpdate.setValues?.publishedAt).toBeInstanceOf(Date)
    // auditBranding uses the static module import; the audit goes through
    // insert with the BRAND_PUBLISHED method - one insert total.
    const inserts = queryRecords().filter((r) => r.kind === "insert")
    expect(inserts).toHaveLength(1)
    expect(inserts[0].values).toMatchObject({ tenantId: TENANT, method: "BRAND_PUBLISHED" })
  })

  it("answers nothingToPublish honestly when there is no draft and writes nothing", async () => {
    mocks.state.selectResults = [[{ tenantId: TENANT, draft: null, published: previouslyPublished, previousPublished: null }]]
    expect(await publishBrandingDraft({ tenantId: TENANT })).toEqual({ nothingToPublish: true })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("answers missing when no branding row exists", async () => {
    mocks.state.selectResults = [[]]
    expect(await publishBrandingDraft({ tenantId: TENANT })).toEqual({ missing: true })
  })
})

describe("Brand Studio rollback swaps the snapshot pair (Batch 135)", () => {
  const published = { primaryColor: "#bad", appName: "Oops" }
  const previous = { primaryColor: "#good", appName: "Stable" }

  it("restores the previous snapshot under the lock and audits the rollback", async () => {
    mocks.state.selectResults = [[{ tenantId: TENANT, published, previousPublished: previous, draft: null }]]
    const result = await rollbackBranding({ tenantId: TENANT })
    expect(result).toEqual({ ok: true, published: previous })

    const updates = queryRecords().filter((r) => r.kind === "update")
    expect(updates[0].setValues).toMatchObject({ published: previous, previousPublished: published, draft: null })
    const inserts = queryRecords().filter((r) => r.kind === "insert")
    expect(inserts[0].values).toMatchObject({ tenantId: TENANT, method: "BRAND_ROLLBACK" })
  })

  it("a first publish has no previous snapshot: the replay answers changed:false and writes nothing", async () => {
    mocks.state.selectResults = [[{ tenantId: TENANT, published, previousPublished: null, draft: null }]]
    expect(await rollbackBranding({ tenantId: TENANT })).toEqual({ changed: false })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("the active branding snapshot a public surface renders (Batch 135)", () => {
  it("a published Brand Studio snapshot wins over the row columns", () => {
    const row = {
      tenantId: TENANT, primaryColor: "#legacy", appName: "LegacyRow", logoUrl: "https://cdn.example/old.png",
      published: { primaryColor: "#studio", appName: "Studio", logoUrl: "https://cdn.example/new.png" },
      previousPublished: null, draft: null,
    } as never
    expect(activeBrandingSnapshot(row)).toMatchObject({ primaryColor: "#studio", appName: "Studio" })
  })

  it("a legacy row without a snapshot keeps rendering its own columns", () => {
    const row = {
      tenantId: TENANT, primaryColor: "#legacy", appName: "LegacyRow",
      hideSslBranding: true, published: null, previousPublished: null, draft: null,
    } as never
    expect(activeBrandingSnapshot(row)).toMatchObject({ primaryColor: "#legacy", appName: "LegacyRow", hideSslBranding: true })
  })

  it("no branding row renders no branding", () => {
    expect(activeBrandingSnapshot(null)).toBeNull()
  })
})

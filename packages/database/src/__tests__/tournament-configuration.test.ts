import { describe, expect, it } from "vitest"
import { calendarDateSchema, decimalMoney, logoSchema, MAX_LOGO_BYTES, moneySchema, primaryColorSchema,
  readPrizePool, readTournamentConfiguration, resizeSeedOrder, tournamentConfigurationSchema } from "../lib/tournament-configuration"

function configuration() {
  return { version: 1, matchType: "custom", overs: 12, location: "Lahore",
    seedOrder: [2, 1, 4, 3], branding: { primaryColor: "#123abc" } }
}

describe("Versioned tournament configuration", () => {
  it("round-trips settings under a namespaced rules key without interpreting other rules", () => {
    expect(readTournamentConfiguration({ wizard: configuration(), penalties: { slowOver: 5 } })).toEqual(configuration())
  })
  it.each([null, [], "old rules", {}, { wizard: { ...configuration(), version: 2 } }])("ignores legacy/unknown rules %s", (rules) => {
    expect(readTournamentConfiguration(rules)).toBeNull()
  })
  it.each([
    { seedOrder: [1, 1] }, { seedOrder: [1, 3] }, { seedOrder: [0, 1] }, { seedOrder: [1.5, 2] },
    { matchType: "t20", overs: 10 }, { matchType: "odi", overs: 20 }, { location: " " },
    { overs: 0 }, { overs: 1.5 }, { branding: { primaryColor: "red;position:absolute" } },
  ])("rejects invalid settings %s", (change) => {
    expect(tournamentConfigurationSchema.safeParse({ ...configuration(), ...change }).success).toBe(false)
  })
  it("rejects unknown settings fields and foreign identity metadata", () => {
    expect(tournamentConfigurationSchema.safeParse({ ...configuration(), tenantId: "foreign" }).success).toBe(false)
  })
  it("preserves valid slot order on capacity changes and appends only missing slots", () => {
    expect(resizeSeedOrder([3, 1, 2, 4], 2)).toEqual([1, 2])
    expect(resizeSeedOrder([2, 1], 4)).toEqual([2, 1, 3, 4])
  })
})

describe("Money and calendar validation", () => {
  it.each([[0, "0.00"], [19.99, "19.99"], [0.29, "0.29"], [99999999.99, "99999999.99"]])(
    "stores %s as a decimal string, not binary JSON money", (amount, expected) => expect(decimalMoney(amount as number)).toBe(expected),
  )
  it.each([-1, 1.001, NaN, Infinity, 100000000])("rejects money outside numeric(10,2): %s", (value) => {
    expect(moneySchema.safeParse(value).success).toBe(false)
  })
  it("reads only the new prize envelope, without rewriting legacy distributions", () => {
    expect(readPrizePool({ version: 1, total: "25000.50" })).toBe("25000.50")
    expect(readPrizePool({ winner: 20000, runnerUp: 10000 })).toBeNull()
    expect(readPrizePool({ version: 1, total: "1.234" })).toBeNull()
  })
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-1", "garbage", "0000-01-01"])("rejects invalid date %s", (value) => {
    expect(calendarDateSchema.safeParse(value).success).toBe(false)
  })
  it("accepts leap days and year boundaries", () => {
    expect(calendarDateSchema.parse("2024-02-29")).toBe("2024-02-29")
    expect(calendarDateSchema.parse("2026-12-31")).toBe("2026-12-31")
  })
})

describe("Bounded branding input", () => {
  it("accepts raster data URLs and credential-free HTTPS image URLs", () => {
    expect(logoSchema.safeParse("data:image/png;base64,aGVsbG8=").success).toBe(true)
    expect(logoSchema.safeParse("https://cdn.example.com/logo.png").success).toBe(true)
    expect(primaryColorSchema.safeParse("#12aBCf").success).toBe(true)
  })
  it.each(["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "http://example.com/logo.png",
    "https://user:password@example.com/logo.png", "data:image/png;base64,not base64", "data:image/png;base64,"])(
    "rejects unsafe branding source %s", (value) => expect(logoSchema.safeParse(value).success).toBe(false),
  )
  it("enforces actual decoded logo bytes at the boundary", () => {
    const atLimit = `data:image/png;base64,${Buffer.alloc(MAX_LOGO_BYTES).toString("base64")}`
    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_LOGO_BYTES + 1).toString("base64")}`
    expect(logoSchema.safeParse(atLimit).success).toBe(true)
    expect(logoSchema.safeParse(oversized).success).toBe(false)
  })
})

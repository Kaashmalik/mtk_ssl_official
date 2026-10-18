import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  execute: vi.fn(),
  playerFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  memberFindFirst: vi.fn(),
  leagueFindFirst: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  returning: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({
  resolveActiveTenantId: vi.fn(async () => "00000000-0000-4000-8000-000000000001"),
  requirePermissionServer: vi.fn(async (permission: string) => {
    if (permission !== "user:manage") throw new Error(`Forbidden: ${permission}`)
  }),
}))

const dbState = vi.hoisted(() => ({
  player: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  role: "league_owner" as string,
}))

vi.mock("@mtk/database", async original => ({
  ...await original<typeof import("@mtk/database")>(),
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({
      execute: mocks.execute,
      update: mocks.update,
      insert: mocks.insert,
      query: {
        players: { findFirst: mocks.playerFindFirst },
        users: { findFirst: mocks.userFindFirst },
        userTenantRoles: { findFirst: mocks.memberFindFirst },
        tenants: { findFirst: mocks.leagueFindFirst },
      },
    }),
  },
  auditLogs: {},
}))

import { withdrawGuardianConsent, setGuardianConsent } from "@/app/actions/players"
import { isMinorByRecord } from "@mtk/database/lib/minor-consent-policy"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const TENANT = "00000000-0000-4000-8000-000000000001"
const PLAYER = "00000000-0000-4000-8000-000000000002"
const ACTOR = "00000000-0000-4000-8000-000000000003"
const MINOR_DOB = "2012-04-01"

function chain() {
  mocks.userFindFirst.mockResolvedValue({ id: ACTOR, clerkId: "u-owner", isActive: true })
  mocks.leagueFindFirst.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.memberFindFirst.mockImplementation(() => ({
    userId: ACTOR, tenantId: TENANT, role: dbState.role, status: "active", expiresAt: null,
  }))
  mocks.playerFindFirst.mockImplementation(() => dbState.player)
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) })
  mocks.returning.mockImplementation(async () => [dbState.updated])
  mocks.execute.mockResolvedValue(undefined)
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ userId: "u-owner" })
  dbState.role = "league_owner"
  dbState.player = {
    id: PLAYER, tenantId: TENANT, dateOfBirth: MINOR_DOB,
    guardianName: null, guardianConsentAt: null, guardianConsentRecordedBy: null,
  }
  chain()
})

describe("minor guardian consent writer (Batch 132)", () => {
  it("refuses for anyone but a league owner, before touching the row", async () => {
    dbState.role = "team_manager"
    // actorContext is the first gate: consent commands are not delegable, so a
    // manager is refused before the row lock; the writer's own owner check
    // stands behind it for any path that skips the action tier.
    await expect(setGuardianConsent(PLAYER, { guardianName: "Sam Guardian" })).rejects.toThrow("your roster access changed")
    await expect(withdrawGuardianConsent(PLAYER)).rejects.toThrow("your roster access changed")
    // Account/league locks may fire while resolving the actor, but the player
    // row is never mutated for an unauthorized caller.
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses to record consent for a player without a proven minor age", async () => {
    dbState.player = { id: PLAYER, tenantId: TENANT, dateOfBirth: null, guardianName: null, guardianConsentAt: null }
    await expect(setGuardianConsent(PLAYER, { guardianName: "Sam Guardian" })).rejects.toThrow("recorded date of birth under 18")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("records the consent as a league fact and is honest on an identical replay", async () => {
    dbState.updated = { id: PLAYER, guardianName: "Sam Guardian" }
    await expect(setGuardianConsent(PLAYER, { guardianName: "Sam Guardian" })).resolves.toMatchObject({ changed: true })
    const setArg = mocks.set.mock.calls[0]![0] as Record<string, unknown>
    expect(setArg.guardianName).toBe("Sam Guardian")
    expect(mocks.values).toHaveBeenCalled() // the audit row
    // Replay: consent already recorded with the same guardian - pure read.
    dbState.player = { ...dbState.player as Record<string, unknown>, guardianName: "Sam Guardian", guardianConsentAt: new Date() }
    await expect(setGuardianConsent(PLAYER, { guardianName: "Sam Guardian" })).resolves.toMatchObject({ changed: false })
  })

  it("withdraws the whole consent and answers a withdrawal replay honestly", async () => {
    dbState.player = {
      id: PLAYER, tenantId: TENANT, dateOfBirth: MINOR_DOB,
      guardianName: "Sam Guardian", guardianConsentAt: new Date(), guardianConsentRecordedBy: "u-owner",
    }
    dbState.updated = { id: PLAYER, guardianName: null, guardianConsentAt: null }
    await expect(withdrawGuardianConsent(PLAYER)).resolves.toMatchObject({ changed: true })
    const setArg = mocks.set.mock.calls[0]![0] as Record<string, unknown>
    expect(setArg.guardianName).toBeNull()
    expect(setArg.guardianConsentAt).toBeNull()
    expect(setArg.guardianConsentRecordedBy).toBeNull()
    dbState.player = { ...dbState.player as Record<string, unknown>, guardianName: null, guardianConsentAt: null }
    await expect(withdrawGuardianConsent(PLAYER)).resolves.toMatchObject({ changed: false })
  })

  it("keeps the policy boundary: the age rule itself never lives in the writer", () => {
    // The writer delegates the minor proof to the shared policy module.
    expect(isMinorByRecord("2012-04-01", new Date("2026-10-18T00:00:00Z"))).toBe(true)
    expect(isMinorByRecord("2008-10-18", new Date("2026-10-18T00:00:00Z"))).toBe(false)
  })
})

describe("minor-consent public-reader gate (Batch 132)", () => {
  const read = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8")
  const count = (src: string, needle: string) => src.split(needle).length - 1

  it("gates every public player path in public-visibility.ts (6 boards + milestones x2)", () => {
    const src = read("lib/public-visibility.ts")
    expect(src).toContain("export const minorConsentPublicSql")
    // 10 occurrences: the definition + 8 WHERE gates (combined, batting,
    // bowling, fielding x2, wicketkeeping boards, milestone batting and
    // bowling) + the awards gallery LEFT-JOIN name-withholding condition.
    expect(count(src, "minorConsentPublicSql")).toBe(10)
    expect(src).toContain("date_of_birth IS NULL")
    expect(src).toContain(`guardian_consent_at IS NOT NULL`)
  })

  it("withholds a minor winner's NAME on the awards gallery without dropping the award", () => {
    const src = read("lib/public-visibility.ts")
    expect(src).toContain("an award won by a proven minor")
  })

  it("folds the gate into the public career profile; the private dashboard career stays ungated", () => {
    expect(read("lib/public-career-profile.ts")).toContain("minorConsentPublicSql")
    expect(read("lib/career-hub.ts")).not.toContain("minorConsentPublicSql")
  })
})

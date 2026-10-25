import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), auth: vi.fn(), select: vi.fn(), getUser: vi.fn(), clerkClient: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({
  currentUser: mocks.currentUser,
  auth: mocks.auth,
  clerkClient: mocks.clerkClient,
}))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))

import { isSuperAdmin } from "@/lib/super-admin"

const CLERK_ID = "clerk-admin"
const dbRow = (role: string, isActive: boolean) => [{ role, isActive }]

function selectReturning(rows: unknown[] | Error) {
  mocks.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)) }) }),
  })
}

const provider = (email?: string) => ({
  id: CLERK_ID,
  emailAddresses: email ? [{ emailAddress: email }] : [],
})

/** Default to unenrolled (free-plan) accounts so single-factor sessions resolve. */
function enrolled(twoFactorEnabled: boolean) {
  mocks.clerkClient.mockResolvedValue({ users: { getUser: mocks.getUser } })
  mocks.getUser.mockResolvedValue({ id: CLERK_ID, twoFactorEnabled })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  mocks.currentUser.mockResolvedValue(provider("kaash0542@gmail.com"))
  mocks.auth.mockResolvedValue({ userId: CLERK_ID, sessionClaims: { fva: [0, 0] } })
  enrolled(false)
  selectReturning(dbRow("league_owner", true))
})
afterEach(() => { vi.unstubAllEnvs() })

describe("isSuperAdmin fails closed on the platform-role check", () => {
  it("demands a fresh second factor from an ENROLLED 2FA account", async () => {
    selectReturning(dbRow("super_admin", true))
    enrolled(true)
    mocks.auth.mockResolvedValue({ userId: CLERK_ID, sessionClaims: { fva: [0, -1] } })
    expect(await isSuperAdmin()).toBe(false)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("permits a single-factor session for an account that cannot enroll (free plan)", async () => {
    selectReturning(dbRow("super_admin", true))
    enrolled(false)
    mocks.auth.mockResolvedValue({ userId: CLERK_ID, sessionClaims: { fva: [0, -1] } })
    expect(await isSuperAdmin()).toBe(true)
  })

  it("fails closed when enrollment state cannot be determined", async () => {
    selectReturning(dbRow("super_admin", true))
    mocks.clerkClient.mockRejectedValue(new Error("Clerk backend unavailable"))
    mocks.auth.mockResolvedValue({ userId: CLERK_ID, sessionClaims: { fva: [0, -1] } })
    expect(await isSuperAdmin()).toBe(false)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("grants only an active platform super_admin row", async () => {
    selectReturning(dbRow("super_admin", true))
    expect(await isSuperAdmin()).toBe(true)
  })

  it.each([["league_owner", true], ["super_admin", false], ["fan", false]])(
    "denies role=%s isActive=%s", async (role, isActive) => {
      selectReturning(dbRow(role as string, isActive as boolean))
      expect(await isSuperAdmin()).toBe(false)
    },
  )

  it("denies when the Clerk session is unauthenticated", async () => {
    mocks.currentUser.mockResolvedValue(null)
    expect(await isSuperAdmin()).toBe(false)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("denies on a database failure instead of trusting the provider email", async () => {
    selectReturning(new Error("Database unavailable"))
    expect(await isSuperAdmin()).toBe(false)
  })

  it("denies when no account row exists yet and no dev fallback matches", async () => {
    selectReturning([])
    expect(await isSuperAdmin()).toBe(false)
  })
})

describe("dev-only email fallback", () => {
  it("matches SUPER_ADMIN_EMAIL outside production when the account row is missing", async () => {
    selectReturning([])
    vi.stubEnv("SUPER_ADMIN_EMAIL", "Kaash0542@Gmail.com") // case-insensitive
    expect(await isSuperAdmin()).toBe(true)
  })

  it("ignores the fallback in production, even on an exact match", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SUPER_ADMIN_EMAIL", "kaash0542@gmail.com")
    selectReturning([])
    expect(await isSuperAdmin()).toBe(false)
  })

  it("never uses the fallback when a real account row exists", async () => {
    selectReturning(dbRow("league_owner", true))
    vi.stubEnv("SUPER_ADMIN_EMAIL", "kaash0542@gmail.com")
    expect(await isSuperAdmin()).toBe(false)
  })
})

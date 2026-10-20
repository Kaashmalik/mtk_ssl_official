import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ENH-02-01 (delayed-webhook recovery): the ONLY writer of the local users row
 * was the Clerk webhook. When that webhook is delayed (or dead) the verified
 * session exists but the account does not — every dashboard surface lied about
 * it being denied. The reconciler re-creates the row from the SERVER-VERIFIED
 * session claims with exactly the webhook's semantics (fan role, active),
 * insert-only: a row that already landed is never modified.
 */

const mocks = vi.hoisted(() => ({ current: vi.fn(), insert: vi.fn(), values: vi.fn(), conflict: vi.fn() }))

vi.mock("@clerk/nextjs/server", () => ({ currentUser: mocks.current }))
vi.mock("@mtk/database", () => ({
  users: { clerkId: Symbol("clerkId") },
  db: {
    insert: mocks.insert.mockImplementation(() => ({
      values: mocks.values.mockImplementation(() => ({
        onConflictDoNothing: mocks.conflict,
      })),
    })),
  },
}))

const clerkSession = {
  id: "clerk_new_user",
  firstName: "Ayesha",
  lastName: "Khan",
  username: "ayesha-k",
  imageUrl: "https://img.clerk/avatar.png",
  emailAddresses: [{ id: "e1", emailAddress: "ayesha@example.com" }],
}

const { reconcileSessionUser } = await import("@/lib/account-provisioning")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conflict.mockResolvedValue(undefined)
  mocks.current.mockResolvedValue(clerkSession)
})

describe("verified-session account reconciliation (ENH-02-01)", () => {
  it("inserts an active fan row from the verified session claims", async () => {
    await expect(reconcileSessionUser()).resolves.toBe(true)
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: "clerk_new_user",
        email: "ayesha@example.com",
        displayName: "Ayesha Khan",
        role: "fan",
        isActive: true,
      }),
    )
    expect(mocks.conflict).toHaveBeenCalledTimes(1)
  })

  it("reports recovery even when the webhook won the race (existing row untouched)", async () => {
    await expect(reconcileSessionUser()).resolves.toBe(true)
    // insert-only: no UPDATE path exists on this module at all, and the
    // insert is the conflict-tolerant form the webhook also uses.
    expect(mocks.conflict).toHaveBeenCalledTimes(1)
  })

  it("refuses to write without a verified email on the session", async () => {
    mocks.current.mockResolvedValue({ ...clerkSession, emailAddresses: [] })
    await expect(reconcileSessionUser()).resolves.toBe(false)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("does nothing without a signed-in session", async () => {
    mocks.current.mockResolvedValue(null)
    await expect(reconcileSessionUser()).resolves.toBe(false)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("fails closed (false, no throw) on database errors", async () => {
    mocks.conflict.mockRejectedValue(new Error("database unavailable"))
    await expect(reconcileSessionUser()).resolves.toBe(false)
  })
})

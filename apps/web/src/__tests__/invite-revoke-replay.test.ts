import { beforeEach, describe, expect, it, vi } from "vitest"
import { revokePendingInvite } from "@/lib/invite-records"

/**
 * IAM-05 command idempotency: revoking an invitation must classify its
 * replays instead of throwing a blanket error — an already-revoked invite is
 * a pure read (no duplicate audit), an accepted one refuses honestly, and an
 * unknown one is a distinct error.
 */

const state = vi.hoisted(() => ({ invite: undefined as unknown, audits: [] as unknown[], updates: 0 }))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { transaction: (fn: any) => fn({
    execute: async () => {},
    query: {
      users: { findFirst: async () => ({ id: ACTOR, isActive: true, clerkId: CLERK }) },
      tenants: { findFirst: async () => ({ id: TENANT, isActive: true }) },
      userTenantRoles: { findFirst: async () => ({ userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }) },
      userInvites: { findFirst: async () => state.invite },
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            state.updates++
            return [{ id: INVITE }]
          },
        }),
      }),
    }),
    insert: () => ({
      values: (payload: any) => {
        state.audits.push(payload)
        return { then: (resolve: any) => resolve([]) }
      },
    }),
  })},
}))

const TENANT = "00000000-0000-4000-8000-0000000000e1"
const ACTOR = "00000000-0000-4000-8000-0000000000e2"
const INVITE = "00000000-0000-4000-8000-0000000000e3"
const CLERK = "clerk_replay_test"
const BASE = { tenantId: TENANT, actorId: ACTOR, clerkId: CLERK, inviteId: INVITE }

beforeEach(() => {
  state.invite = undefined
  state.audits = []
  state.updates = 0
})

describe("revokePendingInvite classified replay (IAM-05)", () => {
  it("writes a revoke once with an audit row", async () => {
    state.invite = { id: INVITE, tenantId: TENANT, status: "pending" }
    const result = await revokePendingInvite(BASE)
    expect(result).toEqual({ inviteId: INVITE, changed: true })
    expect(state.updates).toBe(1)
    expect(state.audits).toHaveLength(1)
    expect((state.audits[0] as any).method).toBe("INVITE_REVOKE")
  })

  it("replays an already-revoked invite as a pure read: no write, no duplicate audit", async () => {
    state.invite = { id: INVITE, tenantId: TENANT, status: "revoked" }
    const result = await revokePendingInvite(BASE)
    expect(result).toEqual({ inviteId: INVITE, changed: false })
    expect(state.updates).toBe(0)
    expect(state.audits).toHaveLength(0)
  })

  it("refuses an accepted invite honestly instead of faking a revoke", async () => {
    state.invite = { id: INVITE, tenantId: TENANT, status: "accepted" }
    await expect(revokePendingInvite(BASE)).rejects.toThrow("already resolved")
    expect(state.updates).toBe(0)
    expect(state.audits).toHaveLength(0)
  })

  it("gives an unknown invite a distinct error so retries cannot mask a wrong-league attempt", async () => {
    state.invite = undefined
    await expect(revokePendingInvite(BASE)).rejects.toThrow("Invitation not found in this league")
    expect(state.updates).toBe(0)
    expect(state.audits).toHaveLength(0)
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { assignScorer } from "@/app/actions/matches"
import { removeMember } from "@/app/actions/users"

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), context: vi.fn(), revalidate: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "clerk", sessionClaims: { fva: [0, 0] } }) }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: async () => {}, resolveActiveTenantId: async () => TENANT }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: vi.fn() }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction }, withTenantContext: async (_context: unknown, run: () => Promise<unknown>) => run(),
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000002"
const OWNER = "00000000-0000-4000-8000-000000000003"
const SCORER = "00000000-0000-4000-8000-000000000004"
const MEMBER = "00000000-0000-4000-8000-000000000005"
const key = { tenantId: TENANT, membershipId: MEMBER, expectedVersion: 0 }
const dialect = new PgDialect()
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

/** A deterministic scheduling double, NOT a PostgreSQL implementation. It
 * stages writes until success and models exclusive row locks/current reads.
 * PostgreSQL lock compatibility, snapshots, triggers and RLS need real DB tests.
 */
function schedule(pauseAt: "users" | "matches" = "users", failAudit = false) {
  const state = { match: { id: MATCH, tenantId: TENANT, scorerId: null as string | null, backupScorerId: null as string | null },
    member: { id: MEMBER, userId: SCORER, tenantId: TENANT, role: "scorer", status: "active", version: 0 } as Record<string, unknown> | null,
    audits: [] as Record<string, unknown>[] }
  const held = barrier(), release = barrier(), blocked = barrier()
  const tails = new Map<string, Promise<void>>()
  let next = 0
  mocks.transaction.mockImplementation(async (run, config) => {
    expect(config).toEqual({ isolationLevel: "read committed" })
    const index = ++next
    const unlock: Array<() => void> = [], writes: Array<() => void> = []
    const ownerMember = { id: OWNER, userId: OWNER, tenantId: TENANT, role: "league_owner", status: "active", version: 0 }
    const tx = {
      execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const { sql, params } = dialect.sqlToQuery(query)
        const table = sql.includes('FROM "matches"') ? "matches" : sql.includes('FROM "users"') ? "users"
          : sql.includes('FROM "tenants"') ? "tenants" : "memberships"
        const ids = table === "users" ? params : [params[0]]
        for (const id of ids) {
          const resource = `${table}:${id}`
          const previous = tails.get(resource)
          const own = barrier()
          tails.set(resource, own.promise)
          if (index === 2 && previous) blocked.resolve()
          if (previous) await previous
          unlock.push(own.resolve)
        }
        if (index === 1 && table === pauseAt) {
          held.resolve()
          await release.promise
        }
        return []
      },
      query: {
        users: { findFirst: async ({ where }: any) => {
          const [id] = dialect.sqlToQuery(where).params
          return id === "clerk" || id === OWNER ? { id: OWNER, clerkId: "clerk", isActive: true, role: "player" }
            : { id: SCORER, isActive: true, role: "player" }
        } },
        tenants: { findFirst: async () => ({ id: TENANT, ownerId: OWNER, isActive: true }) },
        userTenantRoles: { findFirst: async ({ where }: any) => {
          const [id] = dialect.sqlToQuery(where).params
          return id === OWNER ? ownerMember : state.member ? { ...state.member } : null
        } },
        teams: { findFirst: async () => null },
        matches: { findFirst: async ({ where }: any) => {
          const { params } = dialect.sqlToQuery(where)
          if (params[0] === MATCH) return { ...state.match }
          return state.match.scorerId === SCORER || state.match.backupScorerId === SCORER ? { ...state.match } : null
        } },
      },
      update: () => ({ set: (patch: any) => ({ where: () => ({ returning: async () => {
        const updated = { ...state.match, ...patch }
        writes.push(() => { state.match = updated })
        return [updated]
      } }) }) }),
      delete: () => ({ where: () => ({ returning: async () => {
        const deleted = state.member
        writes.push(() => { state.member = null })
        return [deleted]
      } }) }),
      insert: () => ({ values: async (audit: Record<string, unknown>) => {
        if (failAudit && index === 1) throw new Error("Audit unavailable")
        writes.push(() => { state.audits.push(audit) })
      } }),
    }
    try {
      const result = await run(tx)
      for (const write of writes) write()
      return result
    } finally {
      for (const done of unlock.reverse()) done()
    }
  })
  return { state, held: held.promise, release: release.resolve, blocked: blocked.promise }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: TENANT, actorId: OWNER, role: "league_owner" } })
})

describe("Assignment/removal deterministic interleavings (transaction doubles)", () => {
  it.each(["primary", "backup"] as const)("assignment-first: removal sees committed %s after waiting on user locks", async slot => {
    const model = schedule()
    const assignment = assignScorer(MATCH, slot, SCORER)
    await model.held
    const removal = removeMember(key)
    const results = Promise.allSettled([assignment, removal])
    await model.blocked
    model.release()
    const [assigned, removed] = await results
    expect(assigned.status).toBe("fulfilled")
    expect(removed).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("assigned scorer") }) })
    expect(model.state.member).not.toBeNull()
    expect(model.state.match[slot === "primary" ? "scorerId" : "backupScorerId"]).toBe(SCORER)
    expect(model.state.audits.map(audit => audit.method)).toEqual(["MATCH_SCORER_ASSIGN"])
  })
  it.each(["primary", "backup"] as const)("removal-first: %s assignment sees missing membership after waiting", async slot => {
    const model = schedule()
    const removal = removeMember(key)
    await model.held
    const assignment = assignScorer(MATCH, slot, SCORER)
    const results = Promise.allSettled([removal, assignment])
    await model.blocked
    model.release()
    const [removed, assigned] = await results
    expect(removed.status).toBe("fulfilled")
    expect(assigned).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("active scorer") }) })
    expect(model.state.member).toBeNull()
    expect(model.state.match).toMatchObject({ scorerId: null, backupScorerId: null })
    expect(model.state.audits.map(audit => audit.method)).toEqual(["MEMBERSHIP_REMOVE"])
  })
  it("opposite-slot assignments serialize on match before checking duplicate occupancy", async () => {
    const model = schedule("matches")
    const primary = assignScorer(MATCH, "primary", SCORER)
    await model.held
    const backup = assignScorer(MATCH, "backup", SCORER)
    const results = Promise.allSettled([primary, backup])
    await model.blocked
    model.release()
    const [assigned, duplicate] = await results
    expect(assigned.status).toBe("fulfilled")
    expect(duplicate).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("different people") }) })
    expect(model.state.match).toMatchObject({ scorerId: SCORER, backupScorerId: null })
    expect(model.state.audits).toHaveLength(1)
  })
  it("a failed assignment audit releases locks and leaves no staged slot for subsequent removal", async () => {
    const model = schedule("users", true)
    const assignment = assignScorer(MATCH, "primary", SCORER)
    await model.held
    const removal = removeMember(key)
    const results = Promise.allSettled([assignment, removal])
    await model.blocked
    model.release()
    const [failed, removed] = await results
    expect(failed).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "Audit unavailable" }) })
    expect(removed.status).toBe("fulfilled")
    expect(model.state.match.scorerId).toBeNull()
    expect(model.state.member).toBeNull()
    expect(model.state.audits.map(audit => audit.method)).toEqual(["MEMBERSHIP_REMOVE"])
  })
})

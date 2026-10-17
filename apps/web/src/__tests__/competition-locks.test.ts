import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { auditLogs } from "@mtk/database"
import { setCompetitionLock } from "@/lib/competition-locks"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), transaction: vi.fn(), execute: vi.fn(), select: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(), rowReturning: vi.fn(),
  insert: vi.fn(), values: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction, select: mocks.select, update: mocks.update, insert: mocks.insert },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000006"
const ACTOR = "00000000-0000-4000-8000-000000000003"
const dialect = new PgDialect()

const ACTOR_ROW = { id: ACTOR, isActive: true, clerkId: "clerk" }
const MEMBER = { role: "league_owner", status: "active", expiresAt: null }
const LOCKED_AT = new Date("2026-10-01T00:00:00Z")

/** tx.select dispatches per call in order: actor initial + re-read, the
 * tournament row (tenant derivation), the league, the membership. The
 * chains are awaited sequentially, so the live call count identifies the
 * table unambiguously. */
function queueSelects(rows: { actor?: unknown; tournament?: unknown; league?: unknown; member?: unknown }) {
  let tournamentTenantId: string | undefined
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({ limit: async () => {
        const call = mocks.select.mock.calls.length
        if (call === 1 || call === 2) return [rows.actor === undefined ? ACTOR_ROW : rows.actor]
        if (call === 3) {
          const row = rows.tournament === undefined
            ? { id: TOURNAMENT, tenantId: TENANT, competitionLockedAt: null } : rows.tournament
          tournamentTenantId = row === null || row === undefined ? undefined : (row as { tenantId?: string }).tenantId
          return [row]
        }
        if (call === 4) return [rows.league === undefined ? { id: TENANT, isActive: true } : rows.league]
        // Membership is looked up in the tournament's OWN league; the
        // actor has a row only in TENANT.
        if (tournamentTenantId !== TENANT) return [null]
        return [rows.member === undefined ? MEMBER : rows.member]
      } }),
    }),
  }))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.execute.mockResolvedValue([])
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.rowReturning })
  mocks.rowReturning.mockImplementation(async () => {
    const patch = mocks.set.mock.calls.at(-1)![0] as Record<string, unknown>
    return [{ id: TOURNAMENT, competitionLockedAt: patch.competitionLockedAt }]
  })
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue([{ id: 1 }])
  mocks.transaction.mockImplementation(async fn => fn({
    execute: mocks.execute, select: mocks.select, update: mocks.update, insert: mocks.insert,
  }))
})

describe("setCompetitionLock (COMP-07, audited explicit engagement)", () => {
  it("places the lock verbatim with actor provenance and an audited COMPETITION_LOCK", async () => {
    queueSelects({})
    const result = await setCompetitionLock(TOURNAMENT, true)
    expect(result).toMatchObject({ tournamentId: TOURNAMENT, locked: true })
    const patch = mocks.set.mock.calls.at(-1)![0] as { competitionLockedAt: Date; competitionLockedBy: string }
    expect(patch.competitionLockedAt).toBeInstanceOf(Date)
    expect(patch.competitionLockedBy).toBe(ACTOR)
    expect(mocks.insert.mock.calls.at(-1)![0]).toBe(auditLogs)
    expect(mocks.values.mock.calls.at(-1)![0]).toMatchObject({
      tenantId: TENANT, actorId: ACTOR, actorRole: "league_owner", method: "COMPETITION_LOCK",
      path: `/dashboard/tournaments/${TOURNAMENT}`,
      payload: { tournamentId: TOURNAMENT, lock: true, before: { competitionLockedAt: null } },
    })
  })

  it("lifts the lock and clears the provenance actor with COMPETITION_UNLOCK", async () => {
    queueSelects({ tournament: { id: TOURNAMENT, tenantId: TENANT, competitionLockedAt: LOCKED_AT } })
    const result = await setCompetitionLock(TOURNAMENT, false)
    expect(result).toEqual({ tournamentId: TOURNAMENT, locked: false, lockedAt: null })
    expect(mocks.set.mock.calls.at(-1)![0]).toEqual(expect.objectContaining({ competitionLockedAt: null, competitionLockedBy: null }))
    expect(mocks.values.mock.calls.at(-1)![0]).toMatchObject({ method: "COMPETITION_UNLOCK", payload: { lock: false } })
  })

  it("keys the audit and lock to the tournament's OWN league, not the caller's", async () => {
    queueSelects({ tournament: { id: TOURNAMENT, tenantId: TENANT, competitionLockedAt: null } })
    await setCompetitionLock(TOURNAMENT, true)
    const audit = mocks.values.mock.calls.at(-1)![0] as { tenantId: string }
    expect(audit.tenantId).toBe(TENANT)
  })

  it("replays an already-satisfied state without writing or auditing", async () => {
    queueSelects({ tournament: { id: TOURNAMENT, tenantId: TENANT, competitionLockedAt: LOCKED_AT } })
    const result = await setCompetitionLock(TOURNAMENT, true)
    expect(result).toMatchObject({ locked: true })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("locks actor -> competition row -> league -> membership in that order", async () => {
    queueSelects({})
    await setCompetitionLock(TOURNAMENT, true)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.map(l => l.params)).toEqual([[ACTOR], [TOURNAMENT], [TENANT], [ACTOR, TENANT]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[1].sql).toContain("FOR UPDATE")
    expect(locks[2].sql).toContain("FOR SHARE")
    expect(locks[3].sql).toContain("FOR SHARE")
  })

  it.each([null, { ...ACTOR_ROW, isActive: false }, { ...ACTOR_ROW, clerkId: "remapped" }])(
    "fails closed on an unavailable account %s", async actorChange => {
      queueSelects({ actor: actorChange })
      await expect(setCompetitionLock(TOURNAMENT, true)).rejects.toThrow("Forbidden: competition administration account")
      expect(mocks.update).not.toHaveBeenCalled()
    })

  it.each([
    null,
    { id: "00000000-0000-4000-8000-0000000000ff", tenantId: TENANT, competitionLockedAt: null },
  ] as unknown[])("fails closed on a missing tournament row %s", async tournamentChange => {
    queueSelects({ tournament: tournamentChange })
    await expect(setCompetitionLock(TOURNAMENT, true)).rejects.toThrow("Competition not found")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("derives the league from the tournament row and gates on membership there", async () => {
    // A foreign-league row is never "not found" (that would leak nothing
    // anyway) — the caller simply owns no membership in that league, so
    // the league-owner gate rejects with the same message as any other
    // non-owner. Tenant is taken from the row, never the caller.
    queueSelects({ tournament: { id: TOURNAMENT, tenantId: "00000000-0000-4000-8000-0000000000ff", competitionLockedAt: null } })
    await expect(setCompetitionLock(TOURNAMENT, true)).rejects.toThrow("only the league owner can change the competition lock")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { id: TENANT, isActive: false },
    { role: "league_admin", status: "active", expiresAt: null },
    { role: "league_owner", status: "suspended", expiresAt: null },
    { role: "league_owner", status: "active", expiresAt: "2020-01-01T00:00:00Z" },
  ] as unknown[])("admits only an effective league owner %s", async memberChange => {
    queueSelects({ member: memberChange })
    await expect(setCompetitionLock(TOURNAMENT, true)).rejects.toThrow("only the league owner can change the competition lock")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("reports a lost write instead of auditing a phantom state", async () => {
    queueSelects({})
    mocks.rowReturning.mockResolvedValue([])
    await expect(setCompetitionLock(TOURNAMENT, true)).rejects.toThrow("Competition changed. Reload before saving.")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

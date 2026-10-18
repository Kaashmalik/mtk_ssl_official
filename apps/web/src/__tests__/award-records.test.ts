import { beforeEach, describe, expect, it, vi } from "vitest"
import { declareTournamentAward, revokeTournamentAward } from "@/lib/award-records"
import { AWARD_MANAGER_LABELS } from "@/components/tournaments/award-declaration-card"

const mocks = vi.hoisted(() => ({ context: vi.fn(), transaction: vi.fn() }))
vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.context }))
// Real tables and policies pass through; only the db handle is a mock.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction },
}))

const ACTOR = "00000000-0000-4000-8000-0000000000a1"
const TENANT = "00000000-0000-4000-8000-0000000000b2"
const TOURNAMENT = "00000000-0000-4000-8000-0000000000c3"
const PLAYER = "00000000-0000-4000-8000-0000000000d4"
const OTHER_PLAYER = "00000000-0000-4000-8000-0000000000d5"
const TEAM = "00000000-0000-4000-8000-0000000000e5"
const OTHER_TEAM = "00000000-0000-4000-8000-0000000000e6"
const ACTIVE = "00000000-0000-4000-8000-0000000000f7"
const NEW_AWARD = "00000000-0000-4000-8000-0000000000f8"

/**
 * The writer runs a fixed select order inside the transaction:
 * (1) tournament in league, (2) approved registrations, (3) legacy teams,
 * (4) winner row (player OR team), (5) active award row (row-locked).
 * Every chain is awaited through a shared thenable so `where`-terminated
 * queries, `limit`-terminated queries and `for("update").limit` chains all work.
 */
function txMock(specs: unknown[][], { returning = async () => [{ id: NEW_AWARD }] }: { returning?: () => Promise<unknown> } = {}) {
  const select = vi.fn()
  for (const rows of specs) {
    const thenable: any = Promise.resolve(rows)
    thenable.limit = () => thenable
    thenable.for = () => thenable
    select.mockImplementationOnce(() => ({ from: () => ({ where: () => thenable }) }))
  }
  const values = vi.fn()
  const returningFn = vi.fn(returning)
  values.mockReturnValue({ returning: returningFn })
  const set = vi.fn(() => ({ where: async () => undefined }))
  const update = vi.fn(() => ({ set }))
  const insert = vi.fn(() => ({ values }))
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ select, update, set, insert, values, returning: returningFn }))
  return { select, update, set, insert, values, returning: returningFn }
}

const playerInput = { tournamentId: TOURNAMENT, category: "best_batsman", playerId: PLAYER }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ tenantId: TENANT, actorId: ACTOR, clerkId: "clerk", role: "league_owner" })
})

describe("Official award declaration (PUB-04 first slice)", () => {
  it("records the first declaration under tournament:update authority with full provenance", async () => {
    const tx = txMock([[{ id: TOURNAMENT }], [{ teamId: TEAM }], [{ id: TEAM }], [{ teamId: TEAM }], []])

    const result = await declareTournamentAward({ ...playerInput, citation: "  Run machine.  " })

    expect(mocks.context).toHaveBeenCalledWith("tournament:update")
    expect(result).toEqual({ tournamentId: TOURNAMENT, category: "best_batsman", changed: true, awardId: NEW_AWARD, supersededId: null })
    // No prior row -> nothing is superseded, no update issued.
    expect(tx.update).not.toHaveBeenCalled()
    // First tx insert is the award row (tenant-pinned, trimmed citation),
    // second is the tenant-scoped audit entry.
    expect(tx.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: TENANT, tournamentId: TOURNAMENT, category: "best_batsman",
      playerId: PLAYER, teamId: null, citation: "Run machine.", declaredBy: ACTOR,
    }))
    expect(tx.values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "AWARD_DECLARED", tenantId: TENANT, actorId: ACTOR, actorRole: "league_owner",
      payload: expect.objectContaining({ tournamentId: TOURNAMENT, supersededId: null, awardId: NEW_AWARD }),
    }))
  })

  it("is idempotent when the active row already holds the exact decision", async () => {
    const tx = txMock([[{ id: TOURNAMENT }], [{ teamId: TEAM }], [{ id: TEAM }], [{ teamId: TEAM }],
      [{ id: ACTIVE, playerId: PLAYER, teamId: null, citation: "Run machine." }]])

    const result = await declareTournamentAward({ ...playerInput, citation: "Run machine." })

    expect(result).toEqual({ tournamentId: TOURNAMENT, category: "best_batsman", changed: false, awardId: ACTIVE, supersededId: null })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("supersedes the active row on a correction and audits the provenance chain", async () => {
    const tx = txMock([[{ id: TOURNAMENT }], [{ teamId: TEAM }], [{ id: TEAM }], [{ teamId: TEAM }],
      [{ id: ACTIVE, playerId: OTHER_PLAYER, teamId: null, citation: null }]])

    const result = await declareTournamentAward(playerInput)

    expect(result).toEqual({ tournamentId: TOURNAMENT, category: "best_batsman", changed: true, awardId: NEW_AWARD, supersededId: ACTIVE })
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ supersededAt: expect.any(Date) }))
    expect(tx.values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "AWARD_CORRECTED",
      payload: expect.objectContaining({ supersededId: ACTIVE, awardId: NEW_AWARD }),
    }))
    expect(tx.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      citation: null, playerId: PLAYER,
    }))
  })

  it("supports a TEAM winner that is registered in the tournament", async () => {
    const tx = txMock([[{ id: TOURNAMENT }], [{ teamId: TEAM }], [{ id: TEAM }], [{ id: TEAM }], []])

    const result = await declareTournamentAward({ tournamentId: TOURNAMENT, category: "fair_play", teamId: TEAM })

    expect(result.changed).toBe(true)
    expect(tx.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      category: "fair_play", teamId: TEAM, playerId: null,
    }))
    expect(tx.values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      payload: expect.objectContaining({ winner: { teamId: TEAM } }),
    }))
  })

  it.each([
    { name: "both winners at once", input: { tournamentId: TOURNAMENT, category: "best_bowler", playerId: PLAYER, teamId: TEAM } },
    { name: "neither winner", input: { tournamentId: TOURNAMENT, category: "best_bowler" } },
    { name: "an unknown category", input: { tournamentId: TOURNAMENT, category: "fan_favorite", playerId: PLAYER } },
    { name: "an unknown field", input: { ...playerInput, votes: 999 } },
  ])("rejects $name before any authority or database work", async ({ input }) => {
    const tx = txMock([])
    await expect(declareTournamentAward(input as never)).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(tx.select).not.toHaveBeenCalled()
  })

  it("refuses a tournament that does not belong to the active league", async () => {
    const tx = txMock([[], [], [], [], []])
    await expect(declareTournamentAward(playerInput)).rejects.toThrow("tournament not found in this league")
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("refuses a player whose team is not registered in the tournament", async () => {
    const tx = txMock([[{ id: TOURNAMENT }], [{ teamId: OTHER_TEAM }], [], [{ teamId: TEAM }], []])
    await expect(declareTournamentAward(playerInput)).rejects.toThrow("not registered in this tournament")
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("fails closed for a player with no resolvable team", async () => {
    const tx = txMock([[{ id: TOURNAMENT }], [], [], [{ teamId: null }], []])
    await expect(declareTournamentAward(playerInput)).rejects.toThrow("not registered in this tournament")
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("refuses a team winner outside the tournament's registered teams", async () => {
    const tx = txMock([[{ id: TOURNAMENT }], [{ teamId: OTHER_TEAM }], [], [], []])
    await expect(declareTournamentAward({ tournamentId: TOURNAMENT, category: "fair_play", teamId: TEAM }))
      .rejects.toThrow("not registered in this tournament")
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("accepts legacy tournament teams as registered winners", async () => {
    await txMock([[{ id: TOURNAMENT }], [], [{ id: TEAM }], [{ id: TEAM }], []])
    const result = await declareTournamentAward({ tournamentId: TOURNAMENT, category: "fair_play", teamId: TEAM })
    expect(result.changed).toBe(true)
  })

  it("propagates an authority failure without opening a transaction", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(declareTournamentAward(playerInput)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("propagates a database failure instead of faking success", async () => {
    txMock([[{ id: TOURNAMENT }], [{ teamId: TEAM }], [{ id: TEAM }], [{ teamId: TEAM }], []],
      { returning: async () => { throw new Error("Insert failed") } })
    await expect(declareTournamentAward(playerInput)).rejects.toThrow("Insert failed")
  })

  it("never routes the decision through unverified or client-supplied identity", async () => {
    const row = { id: ACTIVE, playerId: OTHER_PLAYER, teamId: null, citation: "Old citation" }
    // The whole decision runs against the server-resolved tenant/actor from
    // requireActiveLeagueContext; no input field can redirect it.
    const tx = txMock([[{ id: TOURNAMENT }], [{ teamId: TEAM }], [{ id: TEAM }], [{ teamId: TEAM }], [row]])
    await declareTournamentAward({ ...playerInput, citation: null })
    expect(tx.values).toHaveBeenNthCalledWith(1, expect.objectContaining({ tenantId: TENANT, declaredBy: ACTOR }))
    expect(tx.values).toHaveBeenNthCalledWith(2, expect.objectContaining({ tenantId: TENANT, actorId: ACTOR }))
  })
})

describe("Official award revocation (PUB-04 close-out)", () => {
  it("withdraws an active award as a supersede with NO successor, audited as revocation", async () => {
    const tx = txMock([[{ id: ACTIVE, category: "best_batsman", playerId: PLAYER, teamId: null }]])

    const result = await revokeTournamentAward({ tournamentId: TOURNAMENT, awardId: ACTIVE })

    expect(mocks.context).toHaveBeenCalledWith("tournament:update")
    expect(result).toEqual({ revoked: true, awardId: ACTIVE, tournamentId: TOURNAMENT, category: "best_batsman" })
    // Supersede, never mutate/delete: only supersededAt moves.
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ supersededAt: expect.any(Date) }))
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "AWARD_REVOKED", tenantId: TENANT, actorId: ACTOR, actorRole: "league_owner",
      payload: expect.objectContaining({
        tournamentId: TOURNAMENT, awardId: ACTIVE, category: "best_batsman",
        winner: { playerId: PLAYER }, revoked: true,
      }),
    }))
  })

  it("is terminal: an already-superseded award revokes nothing new", async () => {
    const tx = txMock([[]])

    await expect(revokeTournamentAward({ tournamentId: TOURNAMENT, awardId: ACTIVE }))
      .rejects.toThrow("award not found in this league, or already superseded")
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it.each([
    { name: "an unknown field", input: { tournamentId: TOURNAMENT, awardId: ACTIVE, hard: true } },
    { name: "a malformed award id", input: { tournamentId: TOURNAMENT, awardId: "nope" } },
  ])("rejects $name before any authority or database work", async ({ input }) => {
    const tx = txMock([])
    await expect(revokeTournamentAward(input as never)).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(tx.select).not.toHaveBeenCalled()
  })
})

describe("Award manager copy for revocation (PUB-04 truthfulness)", () => {
  it("says exactly what revoking does and never claims deletion", () => {
    expect(AWARD_MANAGER_LABELS.revoke).toBe("Revoke")
    expect(AWARD_MANAGER_LABELS.revokeConfirm).toBe("Confirm revoke")
    expect(AWARD_MANAGER_LABELS.revokeNotice).toContain("withdraws")
    expect(AWARD_MANAGER_LABELS.revokeNotice).toContain("no successor")
    expect(AWARD_MANAGER_LABELS.revokeNotice).toContain("auditable")
    expect(AWARD_MANAGER_LABELS.revokeUnchanged).toContain("already superseded")
    // The revocation copy itself never claims deletion; the card-wide intro's
    // "nothing is ever deleted" is a TRUE statement and stays.
    expect(AWARD_MANAGER_LABELS.revokeNotice.toLowerCase()).not.toContain("delete")
    expect(AWARD_MANAGER_LABELS.revokeSuccess.toLowerCase()).not.toContain("delete")
    for (const value of Object.values(AWARD_MANAGER_LABELS)) {
      expect(value.toLowerCase()).not.toContain("permanently remove")
    }
  })
})

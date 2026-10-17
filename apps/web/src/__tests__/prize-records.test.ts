import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  approveTournamentPrize,
  recordPrizePayout,
  saveTournamentPrize,
} from "@/lib/prize-records"

const mocks = vi.hoisted(() => ({ context: vi.fn(), transaction: vi.fn() }))

vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.context }))
// Passthrough for real schema tables + policy; only the db handle is mocked.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction },
}))

const LEAGUE = { tenantId: "t1", actorId: "actor-1", clerkId: "clerk_1", role: "league_owner" }
const TOURNAMENT = "00000000-0000-4000-8000-0000000000b1"
const PRIZE = "00000000-0000-4000-8000-0000000000c1"
const DRAFT = {
  id: PRIZE,
  status: "draft",
  categoryName: "Champion purse",
  placement: "Winner",
  amount: "5000.00",
  currency: "PKR",
  sponsor: null,
}
const APPROVED = { ...DRAFT, status: "approved", approvedAt: new Date("2026-10-17T00:00:00Z"), supersededAt: null }
const PAYOUT_DONE = { ...APPROVED, recordedPayoutAt: new Date("2026-10-17T01:00:00Z"), payoutReference: "ref-1", payoutNote: null }
const SUPERSEDED = { ...APPROVED, supersededAt: new Date("2026-10-17T02:00:00Z"), supersededByPrizeId: "00000000-0000-4000-8000-0000000000c9" }

/** Builds a fixed select order: (1) tournament row, (2+) thenable rows per spec. */
function txMock(selectSpecs: unknown[][]) {
  const calls = { updates: [] as { set: unknown }[], audits: [] as unknown[], updatesCount: 0 }
  const tx = {
    select: vi.fn(() => {
      const rows = selectSpecs.length > 1 ? selectSpecs.shift() : selectSpecs[0]
      return {
        from: () => ({
          where: () => ({
            limit: async () => rows,
            for: () => ({ limit: async () => rows }),
          }),
        }),
      }
    }),
    update: vi.fn(() => ({
      set: (set: unknown) => ({ where: async () => { calls.updates.push({ set }); calls.updatesCount++ } }),
    })),
    insert: vi.fn(() => ({
      values: (payload: any) => {
        // The audit insert is distinguishable by its method payload shape.
        if (payload && typeof payload === "object" && "method" in payload) calls.audits.push(payload)
        return {
          returning: async () => [{ id: PRIZE }],
          then: (resolve: any) => resolve([]),
        }
      },
    })),
  }
  mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
  return { tx, calls }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue(LEAGUE)
})

describe("Tournament prize writer (PUB-05 first slice)", () => {
  it("gates every writer through tournament:update in the active league, re-derived server-side", async () => {
    txMock([[]])
    await expect(saveTournamentPrize({ tournamentId: TOURNAMENT, categoryName: "X" })).rejects.toThrow(
      "Forbidden: tournament not found in this league",
    )
    expect(mocks.context).toHaveBeenCalledWith("tournament:update")
  })

  it("creates a draft with normalized amount, defaulted currency and an audit row", async () => {
    const { tx, calls } = txMock([[{ id: "tid" }]])
    const result = await saveTournamentPrize({ tournamentId: TOURNAMENT, categoryName: "Champion purse", placement: "Winner", amount: "5000" })
    expect(result).toEqual({ tournamentId: TOURNAMENT, prizeId: PRIZE, changed: true })
    const insert = tx.insert.mock.calls.length
    expect(insert).toBe(2) // prize + audit
    const audit = calls.audits[0] as any
    expect(audit.method).toBe("PRIZE_RECORDED")
    expect(audit.payload.amount).toBe("5000.00")
    expect(audit.payload.currency).toBe("PKR")
    expect(audit.payload.status).toBe("draft")
  })

  it("requires a currency to arrive with an amount, and refuses malformed amounts", async () => {
    txMock([[{ id: "tid" }], [DRAFT]])
    await expect(saveTournamentPrize({ tournamentId: TOURNAMENT, categoryName: "X", currency: "PKR" })).rejects.toThrow(
      "A currency is only meaningful together with an amount",
    )
    await expect(saveTournamentPrize({ tournamentId: TOURNAMENT, categoryName: "X", amount: "1.234" })).rejects.toThrow(
      "at most two decimal places",
    )
  })

  it("updates only a DRAFT row, audits before/after, and replays unchanged saves as pure reads", async () => {
    const { calls } = txMock([[{ id: "tid" }], [DRAFT]])
    const result = await saveTournamentPrize({ tournamentId: TOURNAMENT, prizeId: PRIZE, categoryName: "Champion purse", placement: "Winner", amount: "6000" })
    expect(result.changed).toBe(true)
    expect(calls.updatesCount).toBe(1)
    expect((calls.audits[0] as any).method).toBe("PRIZE_UPDATED")

    const replay = txMock([[{ id: "tid" }], [DRAFT]])
    const unchanged = await saveTournamentPrize({ tournamentId: TOURNAMENT, prizeId: PRIZE, categoryName: "Champion purse", placement: "Winner", amount: "5000.00" })
    expect(unchanged.changed).toBe(false)
    expect(replay.calls.updatesCount).toBe(0)
    expect(replay.calls.audits).toHaveLength(0)
  })

  it("freezes approved prizes against edits", async () => {
    txMock([[{ id: "tid" }], [APPROVED]])
    await expect(saveTournamentPrize({ tournamentId: TOURNAMENT, prizeId: PRIZE, categoryName: "X" })).rejects.toThrow(
      "Approved prizes are frozen records and can no longer be edited",
    )
  })

  it("approves a draft once with provenance; a replay is a no-op without a duplicate audit", async () => {
    const { calls } = txMock([[{ id: "tid" }], [DRAFT]])
    const result = await approveTournamentPrize({ tournamentId: TOURNAMENT, prizeId: PRIZE })
    expect(result.changed).toBe(true)
    expect(calls.updatesCount).toBe(1)
    expect((calls.audits[0] as any).method).toBe("PRIZE_APPROVED")

    const replay = txMock([[{ id: "tid" }], [APPROVED]])
    const again = await approveTournamentPrize({ tournamentId: TOURNAMENT, prizeId: PRIZE })
    expect(again.changed).toBe(false)
    expect(replay.calls.updatesCount).toBe(0)
    expect(replay.calls.audits).toHaveLength(0)
  })

  it("records a payout once on an approved prize; identical replays read, differing rewrites refuse", async () => {
    const { calls } = txMock([[{ id: "tid" }], [APPROVED]])
    const result = await recordPrizePayout({ tournamentId: TOURNAMENT, prizeId: PRIZE, reference: "ref-1" })
    expect(result.changed).toBe(true)
    expect(calls.updatesCount).toBe(1)
    expect((calls.audits[0] as any).method).toBe("PRIZE_PAYOUT_RECORDED")

    const replay = txMock([[{ id: "tid" }], [PAYOUT_DONE]])
    const same = await recordPrizePayout({ tournamentId: TOURNAMENT, prizeId: PRIZE, reference: "ref-1" })
    expect(same.changed).toBe(false)
    expect(replay.calls.updatesCount).toBe(0)

    const clash = txMock([[{ id: "tid" }], [PAYOUT_DONE]])
    await expect(recordPrizePayout({ tournamentId: TOURNAMENT, prizeId: PRIZE, reference: "ref-2" })).rejects.toThrow(
      "A payout has already been recorded for this prize",
    )
    expect(clash.calls.updatesCount).toBe(0)
  })

  it("refuses payout records on unapproved prizes", async () => {
    txMock([[{ id: "tid" }], [DRAFT]])
    await expect(recordPrizePayout({ tournamentId: TOURNAMENT, prizeId: PRIZE, reference: "ref-1" })).rejects.toThrow(
      "Only approved prizes can have a payout recorded",
    )
  })

  it("supersedes an approved prize: new draft + frozen history + PRIZE_CORRECTED audit", async () => {
    const { calls } = txMock([[{ id: "tid" }], [APPROVED]])
    const result = await saveTournamentPrize({
      tournamentId: TOURNAMENT, prizeId: PRIZE, supersede: true,
      categoryName: "Champion purse (revised)", placement: "Winner", amount: "7000",
    })
    expect(result.changed).toBe(true)
    // Exactly the supersede update (the new draft is an INSERT, not an UPDATE).
    expect(calls.updatesCount).toBe(1)
    const supersedeUpdate = calls.updates[0] as any
    expect(supersedeUpdate.set.supersededAt).toBeInstanceOf(Date)
    expect(supersedeUpdate.set.supersededByPrizeId).toBe(PRIZE)
    const audit = calls.audits[0] as any
    expect(audit.method).toBe("PRIZE_CORRECTED")
    expect(audit.payload.supersededPrizeId).toBe(PRIZE)
    expect(audit.payload.newPrizeId).toBe(PRIZE)
    expect(audit.payload.after.amount).toBe("7000.00")
    expect(audit.payload.before.amount).toBe("5000.00")
  })

  it("refuses the supersede flag on drafts, identical corrections and already-superseded rows", async () => {
    txMock([[{ id: "tid" }], [DRAFT]])
    await expect(saveTournamentPrize({ tournamentId: TOURNAMENT, prizeId: PRIZE, supersede: true, categoryName: "X" })).rejects.toThrow(
      "Only an approved prize can be superseded — edit the draft directly",
    )

    txMock([[{ id: "tid" }], [APPROVED]])
    await expect(saveTournamentPrize({
      tournamentId: TOURNAMENT, prizeId: PRIZE, supersede: true,
      categoryName: "Champion purse", placement: "Winner", amount: "5000.00",
    })).rejects.toThrow("A correction must change at least one prize field")

    txMock([[{ id: "tid" }], [SUPERSEDED]])
    await expect(saveTournamentPrize({ tournamentId: TOURNAMENT, prizeId: PRIZE, supersede: true, categoryName: "X" })).rejects.toThrow(
      "already been superseded",
    )
  })
})

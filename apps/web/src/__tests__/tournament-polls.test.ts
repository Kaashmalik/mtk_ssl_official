import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTournamentPoll, setTournamentPollStatus, voteOnTournamentPoll, readMyPollVote,
} from "@/lib/tournament-polls"

const mocks = vi.hoisted(() => ({
  league: vi.fn(), fan: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(),
  transaction: vi.fn(), updateSets: [] as Record<string, unknown>[],
  insertPayloads: [] as unknown[],
}))

// Passthrough for real schema tables + policies; only the db handles are mocked.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}))
vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.league }))
vi.mock("@/lib/fan-follows", () => ({ requireFanContext: mocks.fan }))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const ACTOR = "00000000-0000-4000-8000-0000000000a2"
const TOURNAMENT = "00000000-0000-4000-8000-0000000000b1"
const POLL = "00000000-0000-4000-8000-0000000000c1"
const OWNER = { tenantId: TENANT, actorId: ACTOR, role: "owner" }
const FAN = { tenantId: TENANT, actorId: "00000000-0000-4000-8000-0000000000a5", clerkId: "clerk_9", role: "fan" }

/**
 * Select harness for the VOTE path. Call order: (1) poll+tournament join,
 * (2) the fan's existing vote, (3) poll row for results, (4) counts groupBy.
 */
function voteSelectHarness(poll: unknown[], existing: unknown[] = [], resultPoll: unknown[] = [], counts: unknown[] = []) {
  const order = [poll, existing, resultPoll, counts]
  let call = 0
  mocks.select.mockImplementation(() => {
    const rows = order[Math.min(call++, order.length - 1)]
    return {
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => rows }) }),
        where: () => ({
          limit: async () => rows,
          groupBy: async () => rows,
        }),
      }),
    }
  })
  return { call: () => call }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.updateSets.length = 0
  mocks.insertPayloads.length = 0
  mocks.fan.mockResolvedValue(FAN)
  mocks.league.mockResolvedValue(OWNER)
  // drizzle args are not captured in mock.calls past the table - capture the
  // rows payloads through the values() chain instead. `returning` serves the
  // create path; the audit await ignores it.
  mocks.insert.mockImplementation(() => ({
    values: (payload: unknown) => {
      mocks.insertPayloads.push(payload)
      return { returning: async () => [{ id: POLL }], onConflictDoNothing: async () => {} }
    },
  }))
  mocks.update.mockImplementation(() => ({
    set: (set: Record<string, unknown>) => {
      mocks.updateSets.push(set)
      return { where: async () => {} }
    },
  }))
  // Inside transactions the same handles back the tx object.
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
    select: mocks.select, insert: mocks.insert, update: mocks.update,
  }))
})

describe("Poll creation (owner, tournament:update)", () => {
  it("creates a DRAFT poll with trimmed options and audited provenance", async () => {
    // (1) tournament lookup.
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ id: TOURNAMENT }] }) }),
    })

    const result = await createTournamentPoll({
      tournamentId: TOURNAMENT,
      question: "  Who takes the trophy?  ",
      options: [" Team A ", "Team B"],
    })

    expect(result).toEqual({ pollId: POLL })
    const values = mocks.insertPayloads[0] as { question: string; options: string[]; status: string }
    expect(values.question).toBe("Who takes the trophy?")
    expect(values.options).toEqual(["Team A", "Team B"])
    expect(values.status).toBe("draft")
    // Second insert inside the same transaction is the audit row.
    const audit = mocks.insertPayloads[1] as { method?: string }
    expect(audit.method).toBe("POLL_RECORDED")
  })

  it("refuses bad questions and bad option shapes before any query or identity read", async () => {
    await expect(createTournamentPoll({ tournamentId: TOURNAMENT, question: "", options: ["a", "b"] }))
      .rejects.toThrow("poll question")
    await expect(createTournamentPoll({ tournamentId: TOURNAMENT, question: "Q", options: ["a\nc", "b"] }))
      .rejects.toThrow("refused")
    await expect(createTournamentPoll({ tournamentId: TOURNAMENT, question: "Q", options: ["only-one"] }))
      .rejects.toThrow("refused")
    await expect(createTournamentPoll({ tournamentId: "not-a-uuid", question: "Q", options: ["a", "b"] })).rejects.toThrow()
    expect(mocks.league).not.toHaveBeenCalled()
  })

  it("fails closed when the tournament is not in the active league", async () => {
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    })
    await expect(createTournamentPoll({
      tournamentId: TOURNAMENT, question: "Q", options: ["a", "b"],
    })).rejects.toThrow("Forbidden: tournament not found in this league")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("Poll lifecycle (owner, tournament:update)", () => {
  const lockedHarness = (rows: unknown[]) => {
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ for: () => ({ limit: async () => rows }) }) }),
    })
  }

  it("opens a draft under the row lock and audits the transition", async () => {
    lockedHarness([{ id: POLL, status: "draft", tournamentId: TOURNAMENT }])
    const result = await setTournamentPollStatus({ pollId: POLL, status: "open" })
    expect(result).toEqual({ ok: true, status: "open" })
    expect(mocks.updateSets).toHaveLength(1)
    expect(mocks.updateSets[0]).toMatchObject({ status: "open" })
    const audit = mocks.insertPayloads[0] as { method?: string; payload?: { after?: unknown } }
    expect(audit.method).toBe("POLL_LIFECYCLE")
    expect(audit.payload?.after).toEqual({ status: "open" })
  })

  it("refuses a foreign-league poll id honestly and never writes", async () => {
    lockedHarness([])
    const result = await setTournamentPollStatus({ pollId: POLL, status: "open" })
    expect(result).toEqual({ ok: false, reason: "poll_not_found" })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("keeps closed terminal - reopening is refused (votes would resume under different visibility)", async () => {
    lockedHarness([{ id: POLL, status: "closed", tournamentId: TOURNAMENT }])
    const result = await setTournamentPollStatus({ pollId: POLL, status: "open" })
    expect(result).toEqual({ ok: false, reason: "terminal_closed" })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses unknown targets and same-state no-ops", async () => {
    lockedHarness([{ id: POLL, status: "open", tournamentId: TOURNAMENT }])
    expect(await setTournamentPollStatus({ pollId: POLL, status: "live" }))
      .toEqual({ ok: false, reason: "unknown_transition" })
    expect(await setTournamentPollStatus({ pollId: POLL, status: "open" }))
      .toEqual({ ok: false, reason: "unknown_transition" })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe("Poll voting (fan, fan:follow)", () => {
  const pollRow = { id: POLL, status: "open", optionsCount: undefined, options: ["Team A", "Team B", "Team C"], tournamentStatus: "live" }

  it("records a first vote on an open poll of a published tournament and returns fresh counts", async () => {
    voteSelectHarness([pollRow], [], [{ question: "Q", status: "open", options: pollRow.options, counts: [1, 0, 0], total: 1 }], [{ optionIndex: 0, total: 1 }])
    const result = await voteOnTournamentPoll({ pollId: POLL, optionIndex: 0 })
    expect(result).toMatchObject({ action: "recorded", counts: [1, 0, 0] })
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })

  it("switches a vote in place under the unique index - changing one's mind is not abuse", async () => {
    voteSelectHarness([pollRow], [{ optionIndex: 0 }], [{ question: "Q", status: "open", options: pollRow.options, counts: [0, 1, 0], total: 1 }], [])
    mocks.update.mockImplementation(() => ({
      set: (set: Record<string, unknown>) => {
        mocks.updateSets.push(set)
        return { where: async () => {} }
      },
    }))
    const result = await voteOnTournamentPoll({ pollId: POLL, optionIndex: 1 })
    expect(result).toMatchObject({ action: "switched" })
    expect(mocks.updateSets[0]).toMatchObject({ optionIndex: 1 })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("is an honest no-op when the same option is re-submitted", async () => {
    voteSelectHarness([pollRow], [{ optionIndex: 2 }], [{ question: "Q", status: "open", options: pollRow.options, counts: [0, 0, 1], total: 1 }], [])
    const result = await voteOnTournamentPoll({ pollId: POLL, optionIndex: 2 })
    expect(result).toMatchObject({ action: "recorded" })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses closed polls, unknown options and unpublished tournaments before any write", async () => {
    voteSelectHarness([{ ...pollRow, status: "closed" }])
    expect(await voteOnTournamentPoll({ pollId: POLL, optionIndex: 0 })).toMatchObject({ action: "refused", reason: "not_open" })

    voteSelectHarness([pollRow])
    expect(await voteOnTournamentPoll({ pollId: POLL, optionIndex: 7 })).toMatchObject({ action: "refused", reason: "unknown_option" })

    voteSelectHarness([{ ...pollRow, tournamentStatus: "draft" }])
    expect(await voteOnTournamentPoll({ pollId: POLL, optionIndex: 0 })).toMatchObject({ action: "refused", reason: "tournament_unpublished" })

    voteSelectHarness([])
    expect(await voteOnTournamentPoll({ pollId: POLL, optionIndex: 0 })).toMatchObject({ action: "refused", reason: "poll_not_found" })

    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("validates the input shape before any identity read", async () => {
    await expect(voteOnTournamentPoll({ pollId: "not-a-uuid", optionIndex: 0 })).rejects.toThrow()
    await expect(voteOnTournamentPoll({ pollId: POLL, optionIndex: 1.5 })).rejects.toThrow()
    expect(mocks.fan).not.toHaveBeenCalled()
  })
})

describe("Reading my vote", () => {
  it("returns the fan's option only inside their league, else null (fail-closed)", async () => {
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ optionIndex: 1 }] }) }),
    })
    expect(await readMyPollVote(TENANT, POLL)).toBe(1)

    mocks.fan.mockResolvedValue({ ...FAN, tenantId: "00000000-0000-4000-8000-0000000000ff" })
    expect(await readMyPollVote(TENANT, POLL)).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  reportMatchReactionFeed, readOpenReactionReports, decideReactionReport,
  readLeagueOpenReports,
} from "@/lib/fan-report-records"

const mocks = vi.hoisted(() => ({
  fanContext: vi.fn(),
  leagueContext: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  fanBlock: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select, insert: mocks.insert, transaction: mocks.transaction },
}))
vi.mock("@/lib/fan-follows", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/fan-follows")>(),
  requireFanContext: mocks.fanContext,
}))
vi.mock("@/lib/league-reads", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/league-reads")>(),
  requireActiveLeagueContext: mocks.leagueContext,
}))
vi.mock("@/lib/fan-block-records", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/fan-block-records")>(),
  readActiveFanBlockExists: mocks.fanBlock,
}))

const LEAGUE = "00000000-0000-4000-8000-0000000000a1"
const FAN = "00000000-0000-4000-8000-0000000000a3"
const FAN_ROLE = "league_owner" as const // role value is pass-through in the fan context type
const OWNER = {
  tenantId: LEAGUE,
  actorId: "00000000-0000-4000-8000-0000000000a2",
  clerkId: "clerk_o",
  role: "league_owner" as const,
}
const MATCH = "00000000-0000-4000-8000-0000000000b1"
const REPORT = "00000000-0000-4000-8000-0000000000c1"
const PUBLISHED = { status: "live", tournamentStatus: "live" }

/**
 * Select-dispatch for the fan flow: call 1 is the published-target read
 * (from -> innerJoin -> where -> limit), call 2 is the flood count
 * (from -> where, awaited directly).
 */
function fanSelectMock({
  target = PUBLISHED as { status: string; tournamentStatus: string } | null,
  recentReports = 0,
}: {
  target?: { status: string; tournamentStatus: string } | null
  recentReports?: number
} = {}) {
  let selectCall = 0
  return () => {
    selectCall += 1
    if (selectCall === 1) {
      return {
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => (target ? [target] : []) }),
          }),
        }),
      }
    }
    return {
      from: () => ({
        where: async () => [{ total: recentReports }],
      }),
    }
  }
}

/**
 * Insert-dispatch: call 1 is the report row (values -> onConflictDoNothing ->
 * returning), call 2 is the audit row (values, awaited directly).
 */
function insertMock({
  reportReturning = [{ id: REPORT }],
  onValues,
}: {
  reportReturning?: Array<{ id: string }>
  onValues?: (call: number, payload: unknown) => void
} = {}) {
  let insertCall = 0
  return (_table: unknown) => {
    insertCall += 1
    const call = insertCall
    if (call === 1) {
      return {
        values: (payload: unknown) => {
          onValues?.(call, payload)
          return {
            onConflictDoNothing: () => ({
              returning: async () => reportReturning,
            }),
          }
        },
      }
    }
    return {
      values: (payload: unknown) => ({
        then: (resolve: (v: unknown[]) => void) => {
          onValues?.(call, payload)
          resolve([])
        },
      }),
    }
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.fanContext.mockResolvedValue({ tenantId: LEAGUE, actorId: FAN, clerkId: "clerk_f", role: FAN_ROLE })
  mocks.leagueContext.mockResolvedValue(OWNER)
  mocks.fanBlock.mockResolvedValue(false)
})

describe("FAN-01 report a match's reaction feed (fan side)", () => {
  it("opens a report with provenance and audits it", async () => {
    mocks.select.mockImplementation(fanSelectMock())
    const payloads: unknown[] = []
    mocks.insert.mockImplementation(insertMock({ onValues: (_c, p) => payloads.push(p) }))
    const result = await reportMatchReactionFeed({ matchId: MATCH, reason: "spam" })
    expect(result).toEqual({ action: "open", reportId: REPORT })
    expect(payloads[0]).toMatchObject({
      tenantId: LEAGUE, matchId: MATCH, reportedBy: FAN, reason: "spam",
    })
    expect(payloads[1]).toMatchObject({
      method: "REACTION_REPORT",
      path: `/matches/${MATCH}`,
      payload: { matchId: MATCH, reportId: REPORT, reason: "spam" },
    })
  })

  it("replays honestly as already_open without a duplicate insert or an audit", async () => {
    mocks.select.mockImplementation(fanSelectMock())
    const payloads: unknown[] = []
    mocks.insert.mockImplementation(insertMock({ reportReturning: [], onValues: (_c, p) => payloads.push(p) }))
    const result = await reportMatchReactionFeed({ matchId: MATCH, reason: "abusive" })
    expect(result).toEqual({ action: "already_open" })
    expect(payloads).toHaveLength(1) // the absorbed report row, never the audit
  })

  it("refuses an unpublished or cancelled target before any insert", async () => {
    mocks.select.mockImplementation(fanSelectMock({ target: null }))
    mocks.insert.mockImplementation(() => {
      throw new Error("insert must never run on an unpublished target")
    })
    const result = await reportMatchReactionFeed({ matchId: MATCH, reason: "spam" })
    expect(result).toEqual({ action: "refused", reason: "target_unpublished" })
  })

  it("refuses at the flood floor before any insert", async () => {
    mocks.select.mockImplementation(fanSelectMock({ recentReports: 5 }))
    mocks.insert.mockImplementation(() => {
      throw new Error("insert must never run past the flood floor")
    })
    const result = await reportMatchReactionFeed({ matchId: MATCH, reason: "spam" })
    expect(result).toEqual({ action: "refused", reason: "report_rate_limited" })
  })

  it("validates shape and the fixed reason set before any gate or query", async () => {
    await expect(reportMatchReactionFeed({ matchId: "not-a-uuid", reason: "spam" })).rejects.toThrow()
    await expect(reportMatchReactionFeed({ matchId: MATCH, reason: "free text" })).rejects.toThrow()
    expect(mocks.fanContext).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("refuses a league-blocked fan before any target or rate logic runs", async () => {
    mocks.fanBlock.mockResolvedValue(true)
    mocks.select.mockImplementation(() => {
      throw new Error("no query may run past an active block")
    })
    const result = await reportMatchReactionFeed({ matchId: MATCH, reason: "spam" })
    expect(result).toEqual({ action: "refused", reason: "blocked" })
    expect(mocks.fanBlock).toHaveBeenCalledWith(LEAGUE, FAN)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("FAN-01 open-report queue (owner read)", () => {
  it("reads a bounded open-report queue with projection to disclosed fields", async () => {
    const createdAt = new Date("2026-10-18T09:00:00.000Z")
    mocks.select.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [
                { id: REPORT, reason: "spam", reporterName: "Hamza", createdAt },
              ],
            }),
          }),
        }),
      }),
    }))
    const rows = await readOpenReactionReports(MATCH)
    expect(rows).toEqual([
      { id: REPORT, reason: "spam", reporterName: "Hamza", createdAt: createdAt.toISOString() },
    ])
  })

  it("joins both team names per report; a team-less fixture falls back to an honest id label", async () => {
    const createdAt = new Date("2026-10-18T09:30:00.000Z")
    mocks.select.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            leftJoin: () => ({
              leftJoin: () => ({
                where: () => ({
                  orderBy: () => ({
                    limit: async () => [
                      {
                        id: REPORT,
                        matchId: MATCH,
                        teamAName: "United",
                        teamBName: "City",
                        reason: "abusive",
                        reporterName: null,
                        createdAt,
                      },
                      {
                        id: "00000000-0000-4000-8000-0000000000c2",
                        matchId: MATCH,
                        teamAName: null,
                        teamBName: null,
                        reason: "spam",
                        reporterName: "Ada",
                        createdAt,
                      },
                    ],
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }))
    const rows = await readLeagueOpenReports()
    expect(rows).toHaveLength(2)
    // Exact disclosed projection - nothing else travels.
    expect(rows[0]).toEqual({
      id: REPORT,
      matchId: MATCH,
      matchLabel: "United vs City",
      reason: "abusive",
      reporterName: null,
      createdAt: createdAt.toISOString(),
    })
    // Unresolvable teams still surface, with an honest fallback label.
    expect(rows[1].matchLabel).toBe(`Match ${MATCH.slice(0, 8)}`)
  })

  it("refuses non-uuid match ids before the owner gate", async () => {
    await expect(readOpenReactionReports("nope")).rejects.toThrow()
    expect(mocks.leagueContext).not.toHaveBeenCalled()
  })
})

describe("FAN-01 decide a report (owner, locked)", () => {
  function txMock({
    lockedRow = { id: REPORT, status: "open", matchId: MATCH } as { id: string; status: string; matchId: string } | null,
    onUpdate,
    onAudit,
  }: {
    lockedRow?: { id: string; status: string; matchId: string } | null
    onUpdate?: (payload: unknown) => void
    onAudit?: (payload: unknown) => void
  } = {}) {
    return async (fn: (tx: unknown) => Promise<unknown>) => fn({
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: async () => (lockedRow ? [lockedRow] : []) }),
          }),
        }),
      }),
      update: () => ({
        set: (payload: unknown) => {
          onUpdate?.(payload)
          return { where: () => Promise.resolve() }
        },
      }),
      insert: () => ({
        values: (payload: unknown) => ({
          then: (resolve: (v: unknown[]) => void) => {
            onAudit?.(payload)
            resolve([])
          },
        }),
      }),
    })
  }

  it("decides an open report with reviewer provenance and audits it", async () => {
    let updatePayload: unknown = null
    let auditPayload: unknown = null
    mocks.transaction.mockImplementation(txMock({ onUpdate: p => { updatePayload = p }, onAudit: p => { auditPayload = p } }))
    const result = await decideReactionReport({ reportId: REPORT, decision: "actioned" })
    expect(result).toEqual({ decided: true })
    expect(updatePayload).toMatchObject({ status: "actioned", reviewedBy: OWNER.actorId })
    expect((updatePayload as { reviewedAt: Date }).reviewedAt).toBeInstanceOf(Date)
    expect(auditPayload).toMatchObject({
      method: "REACTION_REPORT_DECIDE",
      path: `/dashboard/matches/${MATCH}`,
      payload: { reportId: REPORT, matchId: MATCH, decision: "actioned" },
    })
  })

  it("refuses a replay after a decision instead of re-deciding", async () => {
    mocks.transaction.mockImplementation(txMock({ lockedRow: { id: REPORT, status: "dismissed", matchId: MATCH } }))
    const result = await decideReactionReport({ reportId: REPORT, decision: "actioned" })
    expect(result).toEqual({ decided: false, reason: "already_decided" })
  })

  it("reads a foreign-league report as honestly not found", async () => {
    mocks.transaction.mockImplementation(txMock({ lockedRow: null }))
    const result = await decideReactionReport({ reportId: REPORT, decision: "dismissed" })
    expect(result).toEqual({ decided: false, reason: "not_found" })
  })

  it("refuses unknown decisions before the transaction", async () => {
    await expect(decideReactionReport({ reportId: REPORT, decision: "reopen" })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

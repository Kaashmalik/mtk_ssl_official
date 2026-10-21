import { beforeEach, describe, expect, it, vi } from "vitest"
import { fanOutMatchLifecycleEvent, buildLifecycleSnapshot } from "@/lib/match-fanout"

const mocks = vi.hoisted(() => ({ select: vi.fn(), dispatch: vi.fn() }))

// Passthrough for the real policy and tables; only the db handles and the
// dispatch writer are mocked.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select },
}))
vi.mock("@/lib/notification-dispatch", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/notification-dispatch")>(),
  dispatchNotificationToTournamentFollowers: mocks.dispatch,
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const TOURNEY = "00000000-0000-4000-8000-0000000000d1"
const MATCH = "00000000-0000-4000-8000-0000000000c1"
const TEAM_A = "00000000-0000-4000-8000-0000000000e1"
const TEAM_B = "00000000-0000-4000-8000-0000000000e2"

/** Select order: (1) tournament status, (2) team names. */
function harness(tournament: unknown[], teams: unknown[]) {
  let call = 0
  const order = [tournament, teams]
  mocks.select.mockImplementation(() => {
    const rows = order[Math.min(call++, order.length - 1)]
    return {
      from: () => ({
        where: () => ({
          limit: async () => rows,
          // The team-names read awaits the where() object directly; make it a
          // thenable that resolves to the same rows.
          then: (resolve: (value: unknown) => void) => resolve(rows),
        }),
      }),
    }
  })
}

const SNAPSHOT = {
  id: MATCH, tournamentId: TOURNEY, teamAId: TEAM_A, teamBId: TEAM_B,
  status: "scheduled", scheduledDate: new Date("2026-10-20T14:00:00.000Z"),
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("Match lifecycle fan-out wiring (FAN-02)", () => {
  it("dispatches a rescheduled event with fresh team names and a date-scoped dedup key", async () => {
    harness([{ status: "live" }], [
      { id: TEAM_A, name: "Lions" }, { id: TEAM_B, name: "Falcons" },
    ])
    mocks.dispatch.mockResolvedValue({ fanout: 2, written: 2 })
    await fanOutMatchLifecycleEvent({
      tenantId: TENANT,
      kind: "reschedule",
      before: buildLifecycleSnapshot(SNAPSHOT),
      after: buildLifecycleSnapshot({ ...SNAPSHOT, scheduledDate: new Date("2026-10-21T14:00:00.000Z") }),
    })
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    const call = mocks.dispatch.mock.calls[0][0]
    expect(call).toMatchObject({
      tenantId: TENANT, tournamentId: TOURNEY,
      type: "match_rescheduled", title: "Match rescheduled",
      dedupKey: `match:${MATCH}:rescheduled:2026-10-21T14:00:00.000Z`,
      // ENH-06-03: the notice points at the match it is about, so the bell item
      // (and the push payload) can deep-link into it.
      matchId: MATCH,
    })
    expect(call.body).toContain("Lions vs Falcons")
    expect(call.body).toContain("UTC")
  })

  it("dispatches a start event only when the match actually went live", async () => {
    harness([{ status: "live" }], [{ id: TEAM_A, name: "Lions" }, { id: TEAM_B, name: "Falcons" }])
    mocks.dispatch.mockResolvedValue({ fanout: 1, written: 1 })
    await fanOutMatchLifecycleEvent({
      tenantId: TENANT, kind: "start",
      before: buildLifecycleSnapshot({ ...SNAPSHOT, status: "toss" }),
      after: buildLifecycleSnapshot({ ...SNAPSHOT, status: "live" }),
    })
    expect(mocks.dispatch.mock.calls[0][0]).toMatchObject({ type: "match_started" })
  })

  it("stops on a replay or toss-only write without querying names or dispatching", async () => {
    harness([{ status: "live" }], [])
    await fanOutMatchLifecycleEvent({
      tenantId: TENANT, kind: "start",
      before: buildLifecycleSnapshot({ ...SNAPSHOT, status: "live" }),
      after: buildLifecycleSnapshot({ ...SNAPSHOT, status: "live" }),
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.select).toHaveBeenCalledTimes(1) // tournament read only
  })

  it("never dispatches for a friendly (no competition) or an unpublished tournament", async () => {
    await fanOutMatchLifecycleEvent({
      tenantId: TENANT, kind: "cancel",
      before: buildLifecycleSnapshot({ ...SNAPSHOT, tournamentId: null }),
      after: buildLifecycleSnapshot({ ...SNAPSHOT, tournamentId: null, status: "cancelled" }),
    })
    harness([{ status: "draft" }], [])
    await fanOutMatchLifecycleEvent({
      tenantId: TENANT, kind: "cancel",
      before: buildLifecycleSnapshot(SNAPSHOT),
      after: buildLifecycleSnapshot({ ...SNAPSHOT, status: "cancelled" }),
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it("fails closed when a participating team cannot be read", async () => {
    harness([{ status: "live" }], [{ id: TEAM_A, name: "Lions" }])
    await fanOutMatchLifecycleEvent({
      tenantId: TENANT, kind: "reschedule",
      before: buildLifecycleSnapshot(SNAPSHOT),
      after: buildLifecycleSnapshot({ ...SNAPSHOT, scheduledDate: new Date("2026-10-21T14:00:00.000Z") }),
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})

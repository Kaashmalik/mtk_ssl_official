import { describe, expect, it } from "vitest"

/**
 * Batch 137: the match centre names two teams but never shows WHO was
 * declared to play. CricHeroes shows the announced XI before the toss.
 * The plumbing check found the declarations already exist —
 * `match_playing_xis`, immutable rows superseded on re-declaration, with
 * an owner-approved official gate (`xi_required` + `xi_approved_at`) —
 * so this slice is a fail-closed PUBLIC fold over those rows:
 *
 *  - a side renders only as a COMPLETE declaration: exactly 11 active
 *    rows whose batting orders are the permutation 1..11. Anything
 *    partial or corrupt is NOT an XI, so it renders as "not announced"
 *    rather than a near-empty list pretending completeness.
 *  - names arrive ONLY through the caller's map — the same single
 *    minor-gated name read the scorecards use. The fold invents no
 *    name, no keeper, no order.
 *  - an approval state the league has not confirmed renders the honest
 *    "awaiting official approval" note (the fold just carries the
 *    caller's verdict from the shared `xiIsApproved` policy).
 *  - rows belonging to a stranger team can never appear on either side.
 */

type Row = { teamId: string; playerId: string; battingOrder: number; wicketkeeper: boolean }

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const STRANGER = "00000000-0000-4000-8000-0000000000ff"

const names = (map: Record<string, string>): Map<string, string> => new Map(Object.entries(map))

/** Builds a valid 11-row declaration for `teamId`, players p1..pN. */
function eleven(teamId: string, prefix: string, opts: { keeperOrder?: number; orderOf?: (i: number) => number } = {}): Row[] {
  const orderOf = opts.orderOf ?? ((i: number) => i + 1)
  return Array.from({ length: 11 }, (_, i) => ({
    teamId,
    playerId: `${prefix}-${i + 1}`,
    battingOrder: orderOf(i),
    wicketkeeper: opts.keeperOrder !== undefined && orderOf(i) === opts.keeperOrder,
  }))
}

describe("buildMatchLineups (Batch 137)", () => {
  it("renders both complete declarations in batting order and marks the designated keeper", async () => {
    const { buildMatchLineups } = await import("../lib/match-lineups")
    const rows = [
      ...eleven(A, "pa", { keeperOrder: 1 }),
      ...eleven(B, "pb", { keeperOrder: 7 }),
    ]
    const byId = names({ "pa-1": "Sameer Khan", "pa-2": "Irfan Ali" })
    const out = buildMatchLineups(rows, A, B, byId, false)!
    expect(out.a).not.toBeNull()
    expect(out.b).not.toBeNull()
    expect(out.a!.players).toHaveLength(11)
    expect(out.b!.players).toHaveLength(11)
    expect(out.a!.players[0]).toEqual({ name: "Sameer Khan", wicketkeeper: true })
    expect(out.a!.players[1]).toEqual({ name: "Irfan Ali", wicketkeeper: false })
    // B's keeper is the #7 slot, not position-in-list.
    const keeper = out.b!.players.find((p) => p.wicketkeeper)!
    expect(out.b!.players.indexOf(keeper)).toBe(6)
  })

  it("names flow ONLY through the caller's gate map — unknown or withheld stay honest", async () => {
    const { buildMatchLineups } = await import("../lib/match-lineups")
    const rows = eleven(A, "pa", { keeperOrder: 2 })
    const out = buildMatchLineups(rows, A, B, names({ "pa-3": "Name withheld pending guardian consent" }), false)!
    expect(out.a!.players.find((p) => p.name === "Name withheld pending guardian consent")).toBeTruthy()
    // A declared player with no resolvable name renders the scorecards'
    // existing honest fallback — never a guessed name.
    expect(out.a!.players[0].name).toBe("Unknown Player")
  })

  it("a partial declaration is NOT an XI — that side reads as not announced, never as a short list", async () => {
    const { buildMatchLineups } = await import("../lib/match-lineups")
    const rows = [...eleven(A, "pa"), ...eleven(B, "pb").slice(0, 10)] // B has 10 rows
    const out = buildMatchLineups(rows, A, B, names({}), false)!
    expect(out!.a).not.toBeNull()
    expect(out!.b).toBeNull()
    // BOTH sides partial (or no rows at all) → nothing to show; the page
    // renders no card at all (the component receives null).
    expect(buildMatchLineups(rows.slice(11), A, B, names({}), false)).toBeNull()
    expect(buildMatchLineups([], A, B, names({}), false)).toBeNull()
  })

  it("a corrupt declaration (duplicate or out-of-range order) is refused, not rendered as truth", async () => {
    const { buildMatchLineups } = await import("../lib/match-lineups")
    const duplicated = eleven(A, "pa").map((r) => (r.battingOrder === 2 ? { ...r, battingOrder: 1 } : r))
    expect(buildMatchLineups([...duplicated, ...eleven(B, "pb")], A, B, names({}), false)!.a).toBeNull()
    const outOfRange = eleven(A, "pa").map((r) => (r.battingOrder === 11 ? { ...r, battingOrder: 12 } : r))
    expect(buildMatchLineups([...outOfRange, ...eleven(B, "pb")], A, B, names({}), false)!.a).toBeNull()
  })

  it("two self-claimed keepers on one side mark NO keeper — corrupt detail is never shown as fact", async () => {
    const { buildMatchLineups } = await import("../lib/match-lineups")
    const twoKeepers = eleven(A, "pa").map((r) =>
      r.battingOrder === 1 || r.battingOrder === 9 ? { ...r, wicketkeeper: true } : r,
    )
    const out = buildMatchLineups([...twoKeepers, ...eleven(B, "pb", { keeperOrder: 3 })], A, B, names({}), false)!
    expect(out.a!.players.every((p) => p.wicketkeeper === false)).toBe(true)
    // The unaffected side keeps its real keeper.
    expect(out.b!.players.filter((p) => p.wicketkeeper)).toHaveLength(1)
  })

  it("rows for a stranger team never surface on either side", async () => {
    const { buildMatchLineups } = await import("../lib/match-lineups")
    const rows = [...eleven(STRANGER, "px", { keeperOrder: 1 }), ...eleven(B, "pb", { keeperOrder: 1 })]
    const out = buildMatchLineups(rows, A, B, names({}), false)!
    expect(out!.a).toBeNull()
    expect(out!.b!.players).toHaveLength(11)
  })
})

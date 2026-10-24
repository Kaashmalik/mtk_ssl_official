import { describe, expect, it } from "vitest"

/**
 * Batch 136: the form strip says who is hot; this says who has had the
 * upper hand between THESE two sides. A pure, read-only fold over the
 * SAME tournament match rows the form strip already reads: only decided
 * meetings count (winnerId present and pointing at one of the two — a
 * voided/no-contest match is nobody's win), the share is always honest
 * (never rounded into a fake 100%), and no meetings means NO claim at
 * all (null), not "0-0 all time" stated as fact.
 */

type MeetingRow = {
  id: string
  teamAId: string
  teamBId: string
  winnerId: string | null
}

const meeting = (id: string, a: string, b: string, w: string | null): MeetingRow => ({ id, teamAId: a, teamBId: b, winnerId: w })

const A = "a", B = "b"

describe("Head-to-head (Batch 136)", () => {
  it("counts only decided meetings and names which side each win belongs to", async () => {
    const { buildHeadToHead } = await import("../lib/head-to-head")
    const h2h = buildHeadToHead([
      meeting("m1", A, B, A),
      meeting("m2", B, A, A), // home/away flipped; still A's win
      meeting("m3", A, B, B),
    ], A, B)!
    expect(h2h.meetings).toBe(3)
    expect(h2h.awins).toBe(2)
    expect(h2h.bwins).toBe(1)
  })

  it("undecided matches are nobody's win — counted as meetings, not as victories", async () => {
    const { buildHeadToHead } = await import("../lib/head-to-head")
    const h2h = buildHeadToHead([
      meeting("m1", A, B, A),
      meeting("m2", A, B, null), // abandoned / no result
      meeting("m3", A, B, "stranger"), // a winner that is neither side
    ], A, B)!
    expect(h2h.meetings).toBe(3)
    expect(h2h.awins).toBe(1)
    expect(h2h.bwins).toBe(0)
  })

  it("no decided history means NO claim — null, never a stated '0-0'", async () => {
    const { buildHeadToHead } = await import("../lib/head-to-head")
    expect(buildHeadToHead([], A, B)).toBeNull()
    expect(buildHeadToHead([meeting("m1", A, B, null)], A, B)).toBeNull()
  })
})

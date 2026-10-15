import { describe, expect, it } from "vitest"
import { knockoutStages, planHybridFixtures, planKnockoutFirstRound, planLeagueFixtures,
  rankApprovedTeamIds, resolveSeededSlots } from "@/lib/fixture-planning"

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const unordered = (a: string, b: string) => [a, b].sort().join("|")

function assertSingleRoundRobin(slots: string[]) {
  const plan = planLeagueFixtures(slots)
  const expected = slots.length * (slots.length - 1) / 2
  expect(plan.fixtures).toHaveLength(expected)
  expect(plan.rounds).toHaveLength(slots.length % 2 ? slots.length : slots.length - 1)

  const seen = new Set<string>()
  for (const fixture of plan.fixtures) {
    expect(fixture.teamAId).not.toBe(fixture.teamBId)
    expect(fixture.matchType).toBe("group")
    expect(fixture.groupName).toBeNull()
    const key = unordered(fixture.teamAId, fixture.teamBId)
    expect(seen.has(key)).toBe(false) // every pairing exactly once
    seen.add(key)
  }
  expect(seen.size).toBe(expected)

  // Structural rest check: a team plays at most once per round.
  for (let round = 1; round <= plan.rounds.length; round++) {
    const busy = plan.fixtures.filter(fixture => fixture.round === round)
      .flatMap(fixture => [fixture.teamAId, fixture.teamBId])
    expect(new Set(busy).size).toBe(busy.length)
  }
  return plan
}

describe("approved registrations are ranked deterministically", () => {
  it("orders by earliest approval, then team id; untimestamped last", () => {
    const rows = [
      { teamId: T(3), approvedAt: new Date("2026-01-03") },
      { teamId: T(1), approvedAt: new Date("2026-01-01") },
      { teamId: T(4), approvedAt: null },
      { teamId: T(2), approvedAt: new Date("2026-01-01") },
    ]
    expect(rankApprovedTeamIds(rows)).toEqual([T(1), T(2), T(3), T(4)])

    const unstamped = [
      { teamId: T(9), approvedAt: null },
      { teamId: T(5), approvedAt: null },
    ]
    expect(rankApprovedTeamIds(unstamped)).toEqual([T(5), T(9)])
  })
})

describe("seed binding fills bracket slots", () => {
  const ranked = [T(1), T(2), T(3), T(4)]

  it("uses ranking order when no seed order applies", () => {
    expect(resolveSeededSlots({ rankedTeamIds: ranked })).toEqual(ranked)
    expect(resolveSeededSlots({ rankedTeamIds: ranked, seedOrder: undefined })).toEqual(ranked)
  })

  it("applies a saved slot permutation: seed i occupies slot seedOrder[i-1]", () => {
    expect(resolveSeededSlots({ rankedTeamIds: ranked, seedOrder: [4, 3, 2, 1] }))
      .toEqual([T(4), T(3), T(2), T(1)])
    expect(resolveSeededSlots({ rankedTeamIds: ranked, seedOrder: [2, 4, 1, 3] }))
      .toEqual([T(3), T(1), T(4), T(2)])
  })

  it("fails closed on invalid or mismatched orders", () => {
    expect(() => resolveSeededSlots({ rankedTeamIds: ranked, seedOrder: [1, 1, 2, 3] }))
      .toThrow("not a valid bracket slot permutation")
    expect(() => resolveSeededSlots({ rankedTeamIds: ranked, seedOrder: [1, 2], strict: true }))
      .toThrow("re-save tournament seeding")
    // Group formats tolerate a stale saved order by falling back to ranking.
    expect(resolveSeededSlots({ rankedTeamIds: ranked, seedOrder: [1, 2] })).toEqual(ranked)
    expect(() => resolveSeededSlots({ rankedTeamIds: [T(1)] })).toThrow("at least two approved teams")
  })
})

describe("league round-robin planning (circle method)", () => {
  it("covers every pairing exactly once for even counts with rest per round", () => {
    assertSingleRoundRobin([T(1), T(2), T(3), T(4)])
    assertSingleRoundRobin([T(1), T(2), T(3), T(4), T(5), T(6)])
    assertSingleRoundRobin(Array.from({ length: 10 }, (_, i) => T(i + 1)))
  })

  it("handles odd counts with byes and still covers every pairing", () => {
    assertSingleRoundRobin([T(1), T(2), T(3)])
    assertSingleRoundRobin(Array.from({ length: 7 }, (_, i) => T(i + 1)))
  })

  it("rejects a team playing itself or duplicates", () => {
    expect(() => planLeagueFixtures([T(1), T(1)])).toThrow("at least two distinct teams")
    expect(() => planLeagueFixtures([T(1)])).toThrow("at least two distinct teams")
  })
})

describe("knockout first-round planning", () => {
  it("uses standard top-vs-bottom seeding and stage labels", () => {
    const slots = Array.from({ length: 8 }, (_, i) => T(i + 1))
    const plan = planKnockoutFirstRound(slots)
    expect(plan.rounds).toEqual(["Quarter-finals"])
    expect(plan.fixtures.map(f => [f.teamAId, f.teamBId])).toEqual([
      [T(1), T(8)], [T(2), T(7)], [T(3), T(6)], [T(4), T(5)],
    ])
    expect(plan.fixtures.every(f => f.matchType === "quarter_final")).toBe(true)
  })

  it.each([
    [2, "final", "Final"],
    [4, "semi_final", "Semi-finals"],
    [8, "quarter_final", "Quarter-finals"],
    [16, "knockout", "Round of 16"],
    [32, "knockout", "Preliminary round"],
  ] as const)("labels a %i-team bracket's first round %s", (size, matchType, label) => {
    const plan = planKnockoutFirstRound(Array.from({ length: size }, (_, i) => T(i + 1)))
    expect(plan.rounds).toEqual([label])
    expect(plan.fixtures).toHaveLength(size / 2)
    expect(plan.fixtures.every(f => f.matchType === matchType)).toBe(true)
  })

  it("accepts only power-of-two counts", () => {
    expect(knockoutStages(8)).toEqual([8, 4, 2])
    expect(knockoutStages(2)).toEqual([2])
    expect(() => planKnockoutFirstRound([T(1), T(2), T(3), T(4), T(5), T(6)]))
      .toThrow("2, 4, 8, 16 or 32")
  })
})

describe("hybrid group-stage planning", () => {
  it("builds balanced groups of up to four with complete group round-robins", () => {
    const plan = planHybridFixtures(Array.from({ length: 6 }, (_, i) => T(i + 1)))
    expect(Object.keys(plan.groups).sort()).toEqual(["A", "B"])
    expect(Object.values(plan.groups).map(group => group.length).sort()).toEqual([3, 3])
    // Every group plays a complete single round-robin: C(3,2)=3 matches.
    expect(plan.fixtures).toHaveLength(6)
    for (const fixture of plan.fixtures) {
      const group = plan.groups[fixture.groupName as string]
      expect(group).toContain(fixture.teamAId)
      expect(group).toContain(fixture.teamBId)
      expect(fixture.teamAId).not.toBe(fixture.teamBId)
    }
  })

  it("caps group size at four and sizes groups 4/4/3 for eleven teams", () => {
    const plan = planHybridFixtures(Array.from({ length: 11 }, (_, i) => T(i + 1)))
    expect(Object.values(plan.groups).map(group => group.length).sort()).toEqual([3, 4, 4])
    // c(4,2)*2 + c(3,2) = 6 + 6 + 3 = 15
    expect(plan.fixtures).toHaveLength(15)
    expect(plan.rounds).toEqual(["Group A", "Group B", "Group C"])
  })
})

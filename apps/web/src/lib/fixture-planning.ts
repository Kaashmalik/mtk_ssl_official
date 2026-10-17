/**
 * Competition fixture planning — pure, database-free planners for tournament
 * fixture generation (COMP-04). Registration binding, seeding and the three
 * wizard formats (league / knockout / hybrid) live here so the rules can be
 * regression-tested without a database. The transactional writer that
 * persists plans is lib/fixture-generation.
 *
 * Slot model: teams are ranked by approval (earliest approved = seed 1). An
 * optional saved seed order (bracket slot permutation from the wizard's
 * seeding step) maps seed rank -> bracket slot; fixtures are planned over
 * slots so a saved bracket layout is honoured exactly.
 */

export type PlannedFixture = {
  /** 1-based round within the plan (group rounds / bracket stages). */
  round: number
  /** Group label for hybrid group stages ("A", "B", ...); null otherwise. */
  groupName: string | null
  /** DB match_type for the stage: group or the bracket round label. */
  matchType: "group" | "knockout" | "semi_final" | "quarter_final" | "final"
  teamAId: string
  teamBId: string
}

export type PlannedStructure = {
  /** Round labels in order ("Round 1", "Quarter-final", "Group A", ...). */
  rounds: string[]
  fixtures: PlannedFixture[]
}

type RegistrationRef = {
  teamId: string
  approvedAt: Date | null
}

/** Rank approved registrations deterministically: earliest approval first,
 * unapproved-timestamp approvals last, team id as the final tie-break. */
export function rankApprovedTeamIds(registrations: RegistrationRef[]): string[] {
  return [...registrations]
    .sort((a, b) => {
      const at = a.approvedAt?.getTime() ?? Number.POSITIVE_INFINITY
      const bt = b.approvedAt?.getTime() ?? Number.POSITIVE_INFINITY
      return at !== bt ? at - bt : a.teamId.localeCompare(b.teamId)
    })
    .map(registration => registration.teamId)
}

/** Is `order` a permutation of 1..n exactly once? */
function isPermutationOfSlots(order: number[], n: number): boolean {
  return order.length === n
    && new Set(order).size === n
    && order.every(slot => Number.isInteger(slot) && slot >= 1 && slot <= n)
}

/**
 * Bind ranked teams to bracket slots. Without a saved seed order the ranking
 * itself fills the slots. With one, seed i occupies bracket slot
 * seedOrder[i - 1]; every slot 1..n must appear exactly once. Fail-closed on
 * an invalid or wrong-length order — never silently re-seed.
 */
export function resolveSeededSlots(input: {
  rankedTeamIds: string[]
  seedOrder?: number[]
  /** When true a length mismatch throws instead of reordering nothing. */
  strict?: boolean
}): string[] {
  const { rankedTeamIds, seedOrder, strict = false } = input
  const n = rankedTeamIds.length
  if (n < 2) throw new Error("Fixture generation needs at least two approved teams")
  if (seedOrder && isPermutationOfSlots(seedOrder, n)) {
    const slots: string[] = []
    rankedTeamIds.forEach((teamId, index) => {
      slots[seedOrder[index] - 1] = teamId
    })
    return slots
  }
  if (seedOrder && seedOrder.length === n && !isPermutationOfSlots(seedOrder, n)) {
    throw new Error("Saved seed order is not a valid bracket slot permutation")
  }
  if (seedOrder && strict && seedOrder.length !== n) {
    throw new Error(
      `Saved seed order covers ${seedOrder.length} slots but ${n} teams are approved — re-save tournament seeding`)
  }
  return [...rankedTeamIds]
}

/**
 * Single round-robin (circle method / Berger tables). Every team plays every
 * other exactly once, at most once per round; odd team counts get one bye per
 * round. No team plays twice in a round, so making one round one match-day
 * satisfies the structural rest check.
 */
export function planLeagueFixtures(slots: string[]): PlannedStructure {
  if (new Set(slots).size !== slots.length || slots.length < 2) {
    throw new Error("League fixtures need at least two distinct teams")
  }
  const list: (string | null)[] = slots.length % 2 ? [...slots, null] : [...slots]
  const n = list.length
  const rounds: PlannedFixture[][] = []
  const rotation = list.slice(1)
  for (let r = 0; r < n - 1; r++) {
    const order = [list[0], ...rotation]
    const pairs: PlannedFixture[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = order[i]
      const b = order[n - 1 - i]
      if (a && b) {
        // Alternate home/away by round and index so neither side is always A.
        pairs.push((r + i) % 2 === 0
          ? { round: r + 1, groupName: null, matchType: "group", teamAId: a, teamBId: b }
          : { round: r + 1, groupName: null, matchType: "group", teamAId: b, teamBId: a })
      }
    }
    rounds.push(pairs)
    rotation.unshift(rotation.pop() as string | null)
  }

  return { rounds: rounds.map((_, index) => `Round ${index + 1}`), fixtures: rounds.flat() }
}

const KNOCKOUT_SIZES = [2, 4, 8, 16, 32] as const
type KnockoutSize = typeof KNOCKOUT_SIZES[number]

function knockoutStageLabel(size: KnockoutSize): PlannedFixture["matchType"] {
  if (size === 2) return "final"
  if (size === 4) return "semi_final"
  if (size === 8) return "quarter_final"
  return "knockout" // 16 and 32 start with preliminaries labelled knockout
}

/** Bracket stage sizes for a participant count: 8 -> [8, 4, 2]. */
export function knockoutStages(teamCount: number): KnockoutSize[] {
  if (!KNOCKOUT_SIZES.includes(teamCount as KnockoutSize)) {
    throw new Error(
      `Knockout format needs 2, 4, 8, 16 or 32 approved teams — ${teamCount} is not valid`)
  }
  const stages: KnockoutSize[] = []
  for (let size = teamCount; size >= 2; size /= 2) stages.push(size as KnockoutSize)
  return stages
}

/**
 * First round of a single-elimination bracket. Standard seeding pairs slot 1
 * against the last slot, 2 against the second-last, and so on, keeping top
 * seeds apart until later stages. Only the first round is planned here —
 * participants for later stages come from standings/advancement (COMP-05).
 */
export function planKnockoutFirstRound(slots: string[]): PlannedStructure {
  if (new Set(slots).size !== slots.length) {
    throw new Error("Knockout fixtures need distinct teams")
  }
  const n = slots.length
  const stage = knockoutStageLabel(knockoutStages(n)[0])
  const fixtures: PlannedFixture[] = []
  for (let i = 0; i < n / 2; i++) {
    fixtures.push({
      round: 1,
      groupName: null,
      matchType: stage,
      teamAId: slots[i],
      teamBId: slots[n - 1 - i],
    })
  }
  const stageName = n === 2 ? "Final" : n === 4 ? "Semi-finals" : n === 8 ? "Quarter-finals"
    : n === 16 ? "Round of 16" : "Preliminary round"
  return { rounds: [stageName], fixtures }
}

const HYBRID_MAX_GROUP_SIZE = 4

/**
 * Knockout bracket advancement (COMP-05). Knockout tournaments progress in
 * stages whose fixture counts form a chain: for n teams the stage sizes are
 * n/2, n/4, ..., 2 fixtures. Because a whole stage is always created
 * atomically by fixture generation/advancement, the total number of existing
 * fixtures uniquely identifies the bracket size AND how many stages are
 * complete (the cumulative prefix sums are distinct across all supported
 * sizes). The next round pairs stage winners by the mirror rule (early
 * winner against late winner), which keeps top seeds apart classically.
 */
const KNOCKOUT_STAGE_LABELS: Record<number, PlannedFixture["matchType"]> = {
  2: "final", 4: "semi_final", 8: "quarter_final", 16: "knockout", 32: "knockout",
}
const KNOCKOUT_STAGE_NAMES: Record<number, string> = {
  2: "Final", 4: "Semi-finals", 8: "Quarter-finals", 16: "Round of 16", 32: "Preliminary round",
}

export type AdvancementFixture = {
  matchNumber: number
  status: string | null
  winnerId: string | null
}

export type AdvancementPlan =
  | { kind: "stage"; teamsRemaining: number; matchType: PlannedFixture["matchType"]; stageLabel: string; pairs: [string, string][]; winnersByIdentity: string[] }
  | { kind: "complete"; championId: string }

function cumulativeStageSums(n: number): number[] {
  const sums: number[] = []
  let total = 0
  for (let size = n / 2; size >= 1; size /= 2) {
    total += size
    sums.push(total)
  }
  return sums
}

function matchNumberOrderMismatch(fixtures: AdvancementFixture[]): boolean {
  for (let index = 1; index < fixtures.length; index++) {
    if (fixtures[index].matchNumber <= fixtures[index - 1].matchNumber) return true
  }
  return false
}

/**
 * Plans the next knockout stage from the tournament's existing fixtures.
 * Throws (fail-closed) when fixtures are absent, out of order, undecided,
 * no-result, or don't sum to a supported bracket chain. Returns "complete"
 * when the final is decided — the writer then finishes the tournament.
 */
export function planKnockoutAdvancement(fixtures: AdvancementFixture[]): AdvancementPlan {
  const sorted = [...fixtures].sort((a, b) => a.matchNumber - b.matchNumber)
  if (sorted.length === 0) throw new Error("Generate fixtures before advancing the knockout")
  if (matchNumberOrderMismatch(sorted)) throw new Error("Fixture numbering is inconsistent; resolve it before advancing")

  const decided = sorted.map(fixture => {
    if (fixture.status === "no_result") {
      throw new Error(`Fixture #${fixture.matchNumber} has no result — resolve or reshape it before advancing`)
    }
    if (fixture.status !== "completed" || !fixture.winnerId) {
      throw new Error(`Fixture #${fixture.matchNumber} is undecided — every fixture needs a decided result before advancing`)
    }
    return fixture.winnerId
  })

  const total = sorted.length
  let bracketTeams: number | null = null
  for (const size of [32, 16, 8, 4, 2]) {
    if (cumulativeStageSums(size).includes(total)) {
      bracketTeams = size
      break
    }
  }
  if (bracketTeams === null) {
    throw new Error("Existing fixtures do not match a supported knockout bracket chain")
  }

  const sums = cumulativeStageSums(bracketTeams)
  const doneIndex = sums.findIndex(sum => sum === total)
  const fullChain = doneIndex === sums.length - 1
  if (fullChain) {
    // FAN-03: the champion is the winner of the LAST fixture (the final of
    // the bracket chain) - derived purely, written once by the completion
    // claim, and never re-derived at read time. `decided` is non-null
    // string[] by the fail-closed guard above.
    return { kind: "complete", championId: decided[decided.length - 1] }
  }

  // The most recent completed stage has (bracketTeams >> doneIndex) / 2 fixtures.
  const lastStageFixtureCount = (bracketTeams / 2 ** doneIndex) / 2
  const blockStart = total - lastStageFixtureCount
  const winners = decided.slice(blockStart)
  const teamsRemaining = lastStageFixtureCount // winners count = next bracket size
  const pairs: [string, string][] = []
  for (let i = 0; i < lastStageFixtureCount / 2; i++) {
    pairs.push([winners[i], winners[lastStageFixtureCount - 1 - i]])
  }

  return {
    kind: "stage",
    teamsRemaining,
    matchType: KNOCKOUT_STAGE_LABELS[teamsRemaining],
    stageLabel: KNOCKOUT_STAGE_NAMES[teamsRemaining],
    pairs,
    winnersByIdentity: winners,
  }
}

/**
 * Hybrid (group + knockout) group stage: balanced groups of up to four teams
 * via snake distribution (seed 1 -> group A, 2 -> B, ... then reversed), with
 * a round-robin inside each group. The knockout stage is planned by
 * advancement once group results exist (COMP-05) — one qualifier per group
 * per the wizard's documented assumption.
 */
export function planHybridFixtures(slots: string[]): PlannedStructure & { groups: Record<string, string[]> } {
  if (new Set(slots).size !== slots.length || slots.length < 2) {
    throw new Error("Hybrid fixtures need at least two distinct teams")
  }
  const groupCount = Math.ceil(slots.length / HYBRID_MAX_GROUP_SIZE)
  const groups: string[][] = Array.from({ length: groupCount }, () => [])
  slots.forEach((teamId, index) => {
    const row = Math.floor(index / groupCount)
    const column = index % groupCount
    const groupIndex = row % 2 === 0 ? column : groupCount - 1 - column
    groups[groupIndex].push(teamId)
  })

  const fixtures: PlannedFixture[] = []
  const rounds: string[] = []
  groups.forEach((group, groupIndex) => {
    const label = String.fromCharCode(65 + groupIndex)
    const plan = planLeagueFixtures(group)
    rounds.push(`Group ${label}`)
    // Round numbers are within the group; the group label disambiguates.
    fixtures.push(...plan.fixtures.map(fixture => ({ ...fixture, groupName: label })))
  })

  return { rounds, fixtures, groups: Object.fromEntries(
    groups.map((group, index) => [String.fromCharCode(65 + index), group])) }
}

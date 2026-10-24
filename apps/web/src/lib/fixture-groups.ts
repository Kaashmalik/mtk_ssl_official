/**
 * Batch 129: fixtures read in CricHeroes order — LIVE first, then upcoming,
 * then everything decided. A pure, read-only fold over the SAME match rows
 * the fixtures list already renders: it re-orders and groups only, never
 * relabels (each row's own status badge remains the truthful label). Empty
 * groups are omitted; a tournament with no matches yields null and the
 * page keeps its own honest empty line.
 */

export type FixtureGroupKey = "live" | "upcoming" | "results"

export type FixtureGroup<T> = {
  key: FixtureGroupKey
  count: number
  matches: T[]
}

/** LIVE matches outrank everything; a status the builder has never heard
 * of is never dropped — it lands in results with its own badge. */
export function buildFixtureGroups<T extends { status: string }>(matches: T[]): FixtureGroup<T>[] | null {
  const live: T[] = []
  const upcoming: T[] = []
  const results: T[] = []
  for (const m of matches) {
    if (m.status === "live") live.push(m)
    else if (m.status === "scheduled") upcoming.push(m)
    else results.push(m)
  }
  if (live.length === 0 && upcoming.length === 0 && results.length === 0) return null
  const sections: { key: FixtureGroupKey; matches: T[] }[] = [
    { key: "live", matches: live },
    { key: "upcoming", matches: upcoming },
    { key: "results", matches: results },
  ]
  return sections
    .filter((g) => g.matches.length > 0)
    .map((g) => ({ key: g.key, count: g.matches.length, matches: g.matches }))
}

/**
 * Batch 136: the head-to-head between the match centre's two sides — a
 * pure, read-only fold over the SAME tournament match rows the form strip
 * reads. Only decided meetings count as wins (winnerId present AND
 * pointing at one of the two sides — an abandoned fixture or a winner
 * that is neither team is nobody's victory). Meetings count every played
 * or attempted encounter; wins count only decided ones. No meetings at
 * all (or none decided) yields null: no history, NO claim — never a
 * stated "0-0 all time" dressed up as a record.
 */

export type HeadToHead = {
  /** Every recorded fixture between the two sides, decided or not. */
  meetings: number
  awins: number
  bwins: number
}

export function buildHeadToHead<T extends { teamAId: string; teamBId: string; winnerId: string | null }>(
  matches: T[],
  aId: string,
  bId: string,
): HeadToHead | null {
  let meetings = 0
  let awins = 0
  let bwins = 0
  for (const m of matches) {
    const involvesSides = (m.teamAId === aId && m.teamBId === bId) || (m.teamAId === bId && m.teamBId === aId)
    if (!involvesSides) continue
    meetings++
    if (m.winnerId === aId) awins++
    else if (m.winnerId === bId) bwins++
  }
  if (meetings === 0 || (awins === 0 && bwins === 0)) return null
  return { meetings, awins, bwins }
}

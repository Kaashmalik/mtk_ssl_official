/**
 * ENH-01-04 (SCORE-14): the conflict-head barrier as a pure policy.
 *
 * The offline delivery queue is CAUSAL order - entry N describes the match
 * state entry N+1 was recorded against. When an earlier delivery hit a
 * scoring-revision conflict (HTTP 409) and is kept for review, every later
 * delivery of the SAME account must stay fenced behind it: walking past the
 * unresolved head would compound divergence on top of something the official
 * score already contradicts.
 *
 * Standalone shape (no store import): the store maps its BallData rows onto
 * the prefix returned here.
 */

export interface FlushableDelivery {
  id: string
  conflicted?: boolean
}

/**
 * The flushable PREFIX of an in-scope queue: entries up to (exclusive) the
 * first conflicted entry. Entries after the barrier stay queued; the conflict
 * itself is surfaced through the review selectors, not skipped.
 */
export function syncFlushHead<T extends FlushableDelivery>(queue: readonly T[]): T[] {
  const head: T[] = []
  for (const delivery of queue) {
    if (delivery.conflicted) break
    head.push(delivery)
  }
  return head
}

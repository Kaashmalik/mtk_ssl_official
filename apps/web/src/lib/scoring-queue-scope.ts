/** Storage scoping is not write authority. Every replay still uses the canonical server gate. */
export type ScoringQueueScope = { accountId: string; tenantId: string; matchId: string }

export function validQueueScope(scope: ScoringQueueScope | null | undefined): scope is ScoringQueueScope {
  return !!scope && [scope.accountId, scope.tenantId, scope.matchId].every(value =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 200)
}

export function scoringQueueKey(scope: ScoringQueueScope): string {
  if (!validQueueScope(scope)) throw new Error("Verified scoring account and league context required")
  return JSON.stringify([scope.accountId, scope.tenantId, scope.matchId])
}

export function queueItemInScope(row: { accountId?: string; tenantId?: string; matchId: string }, scope: ScoringQueueScope): boolean {
  return validQueueScope(scope) && row.accountId === scope.accountId && row.tenantId === scope.tenantId && row.matchId === scope.matchId
}

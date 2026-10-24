/**
 * Batch 142 (resilience): the integrity boundary between the persisted
 * `scoring-storage` entry and the live-scoring store.
 *
 * The audit (Batch 142) confirmed the two failure modes this closes:
 *  - VALID JSON with drifted shape hydrates through zustand's default
 *    shallow merge and the NEXT delivery throws TypeError on
 *    `innings.balls.filter(...)` — a scorer frozen mid-innings with no
 *    segment boundary to catch it.
 *  - A version bump (this batch introduces versioning) must never destroy
 *    the local work it was introduced to protect: valid older payloads
 *    migrate IN unchanged.
 *
 * The model is the repo's own `lib/form-drafts.ts`: versioned, shape-
 * checked, every failure mode enumerated. The policy is FAIL-CLOSED PER
 * FIELD, not whole-state: one corrupt innings resets THAT innings (the
 * authoritative server read re-hydrates it on load); everything the
 * sanitizer can vouch for survives. The local record must be exactly
 * trustworthy or gone — never half-trusted, never invented.
 */

/** Structural minimum a persisted innings must show to be trusted. */
function persistedInningsIsTrustworthy(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const i = value as Record<string, unknown>
  if (typeof i.inningsId !== "string" || typeof i.teamId !== "string") return false
  if (!Array.isArray(i.balls) || i.balls.some((b) => typeof b !== "object" || b === null || typeof (b as { id?: unknown }).id !== "string")) return false
  const counters = ["totalRuns", "totalWickets", "totalBalls", "extras", "byes", "legByes", "wides", "noBalls", "currentOver", "currentBall"] as const
  if (!counters.every((key) => typeof i[key] === "number" && Number.isFinite(i[key]) && (i[key] as number) >= 0)) return false
  return i.status === "not_started" || i.status === "in_progress" || i.status === "completed"
}

function persistedHistoryIsTrustworthy(value: unknown): value is { history: unknown[]; historyIndex: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const h = value as Record<string, unknown>
  return Array.isArray(h.history) && typeof h.historyIndex === "number" && Number.isFinite(h.historyIndex)
}


export type SanitizedScoringPersistence = {
  queueScopeKey?: string
  matchId?: string
  handoverEpoch?: number
  scoringRevision?: number
  currentInnings?: 1 | 2 | "super_over"
  innings1?: unknown
  innings2?: unknown
  superOver?: unknown
  innings1History?: { history: unknown[]; historyIndex: number }
  innings2History?: { history: unknown[]; historyIndex: number }
  superOverHistory?: { history: unknown[]; historyIndex: number }
}

/**
 * Validates a persisted scoring-state shape. Invalid fields are dropped
 * (the caller's merge restores their defaults); valid fields pass through
 * untouched. Never throws: the worstTrusted persistence is an empty patch.
 */
export function sanitizePersistedScoring(persisted: unknown): SanitizedScoringPersistence {
  if (typeof persisted !== "object" || persisted === null || Array.isArray(persisted)) return {}

  const p = persisted as Record<string, unknown>
  const out: SanitizedScoringPersistence = {}

  // Scalar session metadata: reset to the store's defaults, never invented.
  if (typeof p.matchId === "string") out.matchId = p.matchId
  else out.matchId = ""
  if (typeof p.queueScopeKey === "string") out.queueScopeKey = p.queueScopeKey
  if (typeof p.handoverEpoch === "number" && Number.isFinite(p.handoverEpoch)) out.handoverEpoch = p.handoverEpoch
  if (typeof p.scoringRevision === "number" && Number.isFinite(p.scoringRevision)) out.scoringRevision = p.scoringRevision
  out.currentInnings = p.currentInnings === 2 ? 2 : p.currentInnings === "super_over" ? "super_over" : 1

  // Innings: trustworthy or null — there is no half-trusted innings.
  for (const key of ["innings1", "innings2", "superOver"] as const) {
    out[key] = persistedInningsIsTrustworthy(p[key]) ? p[key] : null
  }
  // Histories: well-formed or the fresh default.
  for (const key of ["innings1History", "innings2History", "superOverHistory"] as const) {
    out[key] = persistedHistoryIsTrustworthy(p[key])
      ? { history: p[key].history, historyIndex: p[key].historyIndex }
      : { history: [], historyIndex: 0 }
  }
  return out
}

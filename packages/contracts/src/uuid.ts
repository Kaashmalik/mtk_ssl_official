/**
 * Batch 144: THE canonical uuid shape for untrusted id input. The whole
 * API surface validated uuids in half a dozen places with two different
 * regexes — one of which (`[0-9a-fA-F-]{36}`) happily accepted thirty-six
 * dashes and let garbage reach a Postgres cast, surfacing as an unhandled
 * 500 instead of an honest 400/404. One shape, re-used by every door:
 * public routes fail CLOSED at their reader (null → 404), mobile routes
 * answer 400, and the schema drifts nowhere.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True only for the canonical 8-4-4-4-12 hex shape. Never throws. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

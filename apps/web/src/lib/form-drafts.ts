/**
 * UX-03 durable-form draft policy (pure, no I/O).
 *
 * Long league forms (tournaments, matches, venues) lose everything on an
 * accidental refresh or close. These helpers define the honest rules for a
 * localStorage-backed draft: versioned (a form shape change invalidates old
 * drafts rather than corrupting fields), age-limited (a week-old draft is a
 * trap, not a help), shape-validated (only flat JSON-safe values persist)
 * and observable (the caller renders WHEN the draft was saved and a visible
 * discard - restoration is never silent, so the user can reject a stale one).
 *
 * Drafts are per-browser conveniences only: they never hold authority, are
 * never a recovery record, and the server truth always wins on submit.
 */

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const DRAFT_KEY_PREFIX = "mtk-form-draft"

export type PersistableValue = string | number | boolean | null

const FORM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function draftStorageKey(formId: string): string {
  if (!FORM_ID_PATTERN.test(formId)) {
    throw new Error(`Invalid form id for drafts: ${formId}`)
  }
  return `${DRAFT_KEY_PREFIX}:${formId}`
}

export function isPersistableValue(value: unknown): value is PersistableValue {
  if (value === null) return true
  if (typeof value === "string") return true
  if (typeof value === "boolean") return true
  // Only finite numbers survive JSON round-trips intact; NaN/Infinity do not.
  return typeof value === "number" && Number.isFinite(value)
}

export type PersistResult =
  | { ok: true; values: Record<string, PersistableValue>; dropped: string[] }
  | { ok: false; reason: "not_an_object" }

/** Keep the flat JSON-safe subset; report every dropped key so nobody is surprised. */
export function toPersistableValues(values: unknown): PersistResult {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return { ok: false, reason: "not_an_object" }
  }
  const picked: Record<string, PersistableValue> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (isPersistableValue(value)) picked[key] = value
    else dropped.push(key)
  }
  return { ok: true, values: picked, dropped }
}

export type StoredDraftShape = {
  version: number
  savedAt: number
  values: Record<string, PersistableValue>
}

export type DraftParseResult<T> =
  | { status: "restored"; values: T; savedAt: number }
  | {
      status: "discarded"
      reason: "missing" | "unparseable" | "version_mismatch" | "expired" | "invalid_shape"
    }

/**
 * Parse a raw localStorage entry against the form's CURRENT version. Every
 * failure mode has its own reason so diagnostics (and honest UI copy) can
 * name what happened instead of a silent empty restore.
 */
export function parseStoredDraft<T extends Record<string, PersistableValue>>(
  raw: string | null,
  version: number,
  now: number,
): DraftParseResult<T> {
  if (raw === null) return { status: "discarded", reason: "missing" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: "discarded", reason: "unparseable" }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "discarded", reason: "unparseable" }
  }
  const shape = parsed as Partial<StoredDraftShape>
  if (typeof shape.version !== "number" || shape.version !== version) {
    return { status: "discarded", reason: "version_mismatch" }
  }
  if (typeof shape.savedAt !== "number" || !Number.isFinite(shape.savedAt) || shape.savedAt > now) {
    // A future savedAt is clock tampering or a corrupted entry; refuse both.
    return { status: "discarded", reason: "invalid_shape" }
  }
  if (now - shape.savedAt > DRAFT_MAX_AGE_MS) {
    return { status: "discarded", reason: "expired" }
  }
  if (
    shape.values === null ||
    typeof shape.values !== "object" ||
    Array.isArray(shape.values) ||
    !Object.values(shape.values).every(isPersistableValue)
  ) {
    return { status: "discarded", reason: "invalid_shape" }
  }
  return {
    status: "restored",
    values: shape.values as T,
    savedAt: shape.savedAt,
  }
}

export type SerializeResult = { ok: true; raw: string; dropped: string[] } | { ok: false; reason: "empty" }

/** Serialize the persistable subset; an empty persistable set refuses (no point storing nothing). */
export function serializeDraft(
  values: unknown,
  version: number,
  now: number,
): SerializeResult {
  const persist = toPersistableValues(values)
  if (!persist.ok) return { ok: false, reason: "empty" }
  if (Object.keys(persist.values).length === 0) return { ok: false, reason: "empty" }
  const shape: StoredDraftShape = { version, savedAt: now, values: persist.values }
  return { ok: true, raw: JSON.stringify(shape), dropped: persist.dropped }
}

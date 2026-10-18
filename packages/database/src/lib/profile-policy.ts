/**
 * REG-05 (Batch 142): pure display-name policy. The display name is the
 * member's human facing label across leagues; it is NOT identity (the
 * account is users.clerkId) and never security-relevant. Normalization is
 * honest about what is stored: trimming + whitespace collapse, a hard
 * length cap, and an explicit REMOVAL value (null) rather than storing
 * empty strings. Anything rejected is refused with a reason, never
 * silently coerced into something else.
 */

export const DISPLAY_NAME_MAX = 60

export type DisplayNameDecision =
  | { ok: true; value: string | null }
  | { ok: false; reason: string }

export function normalizeDisplayName(input: string | null | undefined): DisplayNameDecision {
  if (input === null || input === undefined) {
    return { ok: true, value: null }
  }
  if (typeof input !== "string") {
    return { ok: false, reason: "Display name must be text" }
  }
  const collapsed = input.trim().replace(/\s+/g, " ")
  if (collapsed.length === 0) {
    // Empty means REMOVE - the member declines a label; an empty string
    // would be a corruption, not a name.
    return { ok: true, value: null }
  }
  if (collapsed.length > DISPLAY_NAME_MAX) {
    return { ok: false, reason: `Display name must be at most ${DISPLAY_NAME_MAX} characters` }
  }
  return { ok: true, value: collapsed }
}

export function describeDisplayName(displayName: string | null): string {
  return displayName
    ? `Your name shows as "${displayName}" across leagues.`
    : "No display name set. League records show you as unnamed."
}

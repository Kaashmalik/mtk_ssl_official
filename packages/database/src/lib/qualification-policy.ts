/**
 * Batch 146: standings qualification markers — the MECHANISM only.
 *
 * Qualification policy was (correctly) refused as a platform decision on
 * the owner-decision register, so NOTHING here invents one. The policy is
 * the league ORGANIZER's: an optional, strictly-validated rule stored in
 * the tournament's own `rules` jsonb (the same namespaced pattern the
 * wizard configuration already uses — no schema migration, no policy in
 * code). A null/absent/malformed rule means NO marker renders anywhere;
 * the public legend restates the organizer's rule verbatim, attributed to
 * them — never to the platform.
 */

export const QUALIFICATION_RULES_KEY = "qualification"

/** Maximum spots bound: the tournament schema caps teams at 128. */
const MAX_SPOTS = 128

export type QualificationRule =
  | { kind: "top_n"; spots: number }
  | { kind: "top_per_group"; perGroup: number }

function isBoundedInteger(value: unknown, min = 1, max = MAX_SPOTS): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Strict read. ANY deviation — wrong kind, missing/out-of-bounds sizes,
 * extra junk, a non-object blob — returns null, which every renderer treats
 * as "no markers". A drifted or hostile rules blob can never invent or
 * distort a policy on a public surface.
 */
export function readQualificationRule(rules: unknown): QualificationRule | null {
  if (typeof rules !== "object" || rules === null || Array.isArray(rules)) return null
  const raw = (rules as Record<string, unknown>)[QUALIFICATION_RULES_KEY]
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  if ("kind" in raw && Object.keys(raw).length !== 2) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.kind === "top_n" && isBoundedInteger(candidate.spots)) {
    return { kind: "top_n", spots: candidate.spots }
  }
  if (candidate.kind === "top_per_group" && isBoundedInteger(candidate.perGroup)) {
    return { kind: "top_per_group", perGroup: candidate.perGroup }
  }
  return null
}

/**
 * Merge into the tournament's existing rules object, preserving every
 * other namespaced key (the wizard configuration in particular). Passing
 * null CLEARS the key — "none" is an explicit organizer choice, too.
 * Never mutates the input.
 */
export function writeQualificationRule(
  existing: unknown,
  rule: QualificationRule | null,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  if (rule === null) {
    delete base[QUALIFICATION_RULES_KEY]
  } else {
    const clean =
      rule.kind === "top_n"
        ? { kind: "top_n", spots: rule.spots }
        : { kind: "top_per_group", perGroup: rule.perGroup }
    base[QUALIFICATION_RULES_KEY] = clean
  }
  return base
}

/** Verbatim restatement of the organizer's rule — no platform phrasing. */
export function formatQualificationRule(rule: QualificationRule): string {
  if (rule.kind === "top_n") {
    return rule.spots === 1 ? "Top 1 advances" : `Top ${rule.spots} advance`
  }
  return rule.perGroup === 1
    ? "Top 1 per group advances"
    : `Top ${rule.perGroup} per group advance`
}

/**
 * The qualifying team ids, in each table's ALREADY-computed engine order.
 * Presentation only: rows/groups arrive ranked by the versioned standings
 * engine; this is a slice of that order, nothing re-sorted or re-computed.
 * A null rule yields an empty set — the honest default.
 */
export function computeQualifyingTeamIds({
  rule,
  rows,
  groups,
}: {
  rule: QualificationRule | null
  rows: { teamId: string }[]
  groups: { rows: { teamId: string }[] }[]
}): string[] {
  if (!rule) return []
  if (rule.kind === "top_n") {
    return rows.slice(0, rule.spots).map((row) => row.teamId)
  }
  return groups.flatMap((group) => group.rows.slice(0, rule.perGroup).map((row) => row.teamId))
}

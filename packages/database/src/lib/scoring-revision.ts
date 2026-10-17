export const SCORING_CONFLICT_MESSAGE = "The official score changed. Review saved deliveries before retrying."
export const MAX_SCORING_REVISION = 2147483647

export function scoringRevisionDecision(expected: number | null | undefined, current: number | null | undefined):
  { status: "accepted"; current: number; next: number } | { status: "conflict"; current: number; reason: string } {
  const revision = current ?? 0
  if (!Number.isInteger(revision) || revision < 0 || revision >= MAX_SCORING_REVISION) {
    return { status: "conflict", current: Number.isInteger(revision) && revision >= 0 ? revision : 0,
      reason: "Scoring revision requires league review before further writes." }
  }
  // Missing tokens only work for a never-mutated match, not a legacy bypass.
  if ((expected == null && revision === 0) || (Number.isInteger(expected) && expected === revision)) {
    return { status: "accepted", current: revision, next: revision + 1 }
  }
  return { status: "conflict", current: revision, reason: SCORING_CONFLICT_MESSAGE }
}

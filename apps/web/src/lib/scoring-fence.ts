/**
 * Client-side mirror of the SCORE-11 writer fence. The canonical scoring
 * service rejects writes whose echoed handover epoch is stale (or that carry
 * no token after the first handover) with a stable message; this module
 * recognizes those rejections so the scoring UI can treat them as TERMINAL -
 * retrying a fenced write cannot succeed, the offline queue must retain the
 * delivery for the reloaded session, and the scorer needs a reload prompt
 * instead of a generic failure.
 */

import { ScoringRevisionConflict, type ScoringRevisionFailure } from "./scoring-revision-client";

export const HANDOVER_RESYNC_COPY =
  "A scorer handover occurred. Reload the scoring session before writing.";

export type ScoringFenceFailure = {
  success: false;
  code: "SCORING_SESSION_FENCED";
  message: string;
};

/** Expected action errors must survive production Server Action serialization. */
export function unwrapScoringFenceResult<T>(result: T | ScoringFenceFailure | ScoringRevisionFailure): T {
  if (result && typeof result === "object" && "code" in result &&
      result.code === "SCORING_REVISION_CONFLICT" && "currentRevision" in result &&
      typeof result.currentRevision === "number") {
    throw new ScoringRevisionConflict(result.currentRevision,
      "message" in result && typeof result.message === "string" ? result.message : undefined);
  }
  if (result && typeof result === "object" && "code" in result &&
      result.code === "SCORING_SESSION_FENCED") {
    // Construct this in the browser: Next redacts thrown server messages.
    throw new Error(HANDOVER_RESYNC_COPY);
  }
  return result as T;
}

/** Canonical service messages (ForbiddenException) that mark a fenced write. */
const FENCE_MARKERS = [
  "A scorer handover occurred",
  "Invalid scoring session token",
] as const;

export function isHandoverFencingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message
    : typeof error === "string" ? error : null;
  if (!message) return false;
  return FENCE_MARKERS.some((marker) => message.includes(marker));
}

export function scoringWriteConflictMessage(error: unknown): string | undefined {
  if (error instanceof ScoringRevisionConflict) return error.message;
  if (isHandoverFencingError(error)) return HANDOVER_RESYNC_COPY;
  return undefined;
}

/**
 * The handover epoch a scoring session last observed, from the match snapshot
 * (`getMatchForScoring`). An unread/undefined epoch stays undefined - the
 * server treats its absence as "no token" and still accepts it until the
 * first handover occurs, matching the legacy-safe contract.
 */
export function scoringHandoverEpoch(
  match: { handoverEpoch?: number | null } | null | undefined,
): number | undefined {
  if (!match || match.handoverEpoch === null || match.handoverEpoch === undefined) return undefined;
  return match.handoverEpoch;
}

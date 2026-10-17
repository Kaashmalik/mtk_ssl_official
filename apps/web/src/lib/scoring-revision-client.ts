import { SCORING_CONFLICT_MESSAGE } from "@mtk/database/lib/scoring-revision"

export type ScoringRevisionFailure = {
  success: false;
  code: "SCORING_REVISION_CONFLICT";
  currentRevision: number;
  message: string;
}

export class ScoringRevisionConflict extends Error {
  readonly code = "SCORING_REVISION_CONFLICT"
  constructor(readonly currentRevision: number, message = SCORING_CONFLICT_MESSAGE) {
    super(message)
    this.name = "ScoringRevisionConflict"
  }
}

export function isScoringRevisionConflict(error: unknown): error is ScoringRevisionConflict {
  return error instanceof ScoringRevisionConflict
}

import { HANDOVER_RESYNC_COPY, isHandoverFencingError, type ScoringFenceFailure } from "./scoring-fence"
import { ScoringRevisionConflict, type ScoringRevisionFailure } from "./scoring-revision-client"

/** Return only the expected fence failure; never expose other server errors. */
export function withScoringFence<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result>,
) {
  return async (...args: Args): Promise<Result | ScoringFenceFailure | ScoringRevisionFailure> => {
    try {
      return await handler(...args)
    } catch (error) {
      if (error instanceof ScoringRevisionConflict) return { success: false,
        code: "SCORING_REVISION_CONFLICT", message: error.message, currentRevision: error.currentRevision }
      if (!isHandoverFencingError(error)) throw error
      return { success: false, code: "SCORING_SESSION_FENCED", message: HANDOVER_RESYNC_COPY }
    }
  }
}

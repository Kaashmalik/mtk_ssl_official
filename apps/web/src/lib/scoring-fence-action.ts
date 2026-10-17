import { HANDOVER_RESYNC_COPY, isHandoverFencingError, type ScoringFenceFailure } from "./scoring-fence"

/** Return only the expected fence failure; never expose other server errors. */
export function withScoringFence<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result>,
) {
  return async (...args: Args): Promise<Result | ScoringFenceFailure> => {
    try {
      return await handler(...args)
    } catch (error) {
      if (!isHandoverFencingError(error)) throw error
      return { success: false, code: "SCORING_SESSION_FENCED", message: HANDOVER_RESYNC_COPY }
    }
  }
}

/**
 * Client-side helper for turning a caught server-action error into something a
 * user can act on.
 *
 * Why this exists
 * ---------------
 * `checkPlanLimit` / `checkPlanFeature` in `@mtk/database` embed a JSON payload in
 * the error `message`, because a server action crossing the RSC boundary keeps
 * only `message`/`digest`. That means `err.message` now looks like
 * `[PLAN_LIMIT_REACHED]{"code":"PLAN_LIMIT_REACHED",...}`.
 *
 * Forms used to do `err instanceof Error ? err.message : "..."`, which would dump
 * that raw payload into the UI. Every caller should use `resolveActionError`
 * instead, which recognises the prefix, strips it, and reports the plan-limit
 * detail so the UI can offer an upgrade path.
 */

import {
  readPlanLimitDetail,
  type PlanLimitDetail,
} from "@mtk/database";

export interface ResolvedActionError {
  /** Message safe to render directly. Never contains the wire payload. */
  message: string;
  /** Non-null when the failure was a plan restriction, not a real error. */
  planLimit: PlanLimitDetail | null;
}

/**
 * Normalises any thrown value into a displayable message plus optional plan
 * detail.
 *
 * @param err    Whatever was thrown by the action.
 * @param fallback Message to use when `err` carries nothing usable.
 */
export function resolveActionError(
  err: unknown,
  fallback: string,
): ResolvedActionError {
  const planLimit = readPlanLimitDetail(err);
  if (planLimit) {
    return { message: planLimit.message, planLimit };
  }

  const rawMessage =
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : undefined;

  // Belt and braces: if a future refactor changes the prefix, never let raw
  // internal text through to the user.
  if (rawMessage && rawMessage.startsWith("[PLAN_LIMIT")) {
    return { message: fallback, planLimit: null };
  }

  return { message: rawMessage ?? fallback, planLimit: null };
}
/**
 * Shared plan-limit guard.
 *
 * Why this exists
 * ---------------
 * Plan quotas used to be enforced inline at each call site
 * (`teams.ts` counted teams, `players.ts` counted players, `matches.ts` gated
 * `liveStreaming`). That had two problems:
 *
 *   1. Each site hand-rolled the arithmetic and the copy, so the wording and the
 *      boundary condition drifted apart.
 *   2. A new action that forgot the check would silently have no limit at all —
 *      nothing forced it, and there was no test that would notice.
 *
 * This module centralises the decision and, crucially, throws a **structured**
 * error carrying a machine-readable `code`. Callers in the UI can therefore tell
 * "you need to upgrade" apart from a genuine failure and render an upgrade
 * prompt, instead of dumping an English sentence at the user as a generic
 * error toast.
 */

import {
  PLAN_LIMITS,
  type PlanKey,
  type PlanLimits,
} from "./plan-limits";

/** Numeric quotas. Mirrors the `number`-valued fields of `PlanLimits`. */
export type QuotaFeature = "maxTeams" | "maxPlayers";

/** Boolean capability gates. */
export type FeatureGate =
  | "whiteLabel"
  | "customDomain"
  | "liveStreaming";

/**
 * Stable, machine-readable discriminator. Do not rename: the UI and any
 * cross-version clients match on this string.
 */
export const PLAN_LIMIT_CODE = "PLAN_LIMIT_REACHED" as const;

/** Prefix used to recover the detail after the error crosses the RSC boundary. */
const SERIALISED_PREFIX = `[${PLAN_LIMIT_CODE}]`;

export interface PlanLimitDetail {
  code: typeof PLAN_LIMIT_CODE;
  /** Which limit was hit, for copy and for targeting analytics. */
  feature: QuotaFeature | FeatureGate;
  /** Current usage. `0` for feature gates, which are not counted. */
  current: number;
  /** The ceiling that was hit. `0` for boolean feature gates. */
  allowed: number;
  /** The tenant's plan at the time of the check. */
  currentPlan: PlanKey;
  /** Cheapest plan that would lift this specific restriction. */
  suggestedPlan: PlanKey;
  /** Human-readable explanation, safe to show in the UI. */
  message: string;
}

/** Ordering used to pick the cheapest plan that satisfies a requirement. */
const PLAN_ORDER: readonly PlanKey[] = ["free", "starter", "pro", "enterprise"];

/**
 * Finds the cheapest plan that allows strictly more than `current` for a quota.
 * Returns `null` when no plan does — which means the tenant is already on the
 * most generous plan and the limit is a hard cap, not an upsell.
 */
function cheapestPlanAllowingMore(
  feature: QuotaFeature,
  current: number,
  startingAfter: PlanKey,
): PlanKey | null {
  const currentIndex = PLAN_ORDER.indexOf(startingAfter);
  for (let i = currentIndex + 1; i < PLAN_ORDER.length; i += 1) {
    const candidate = PLAN_ORDER[i];
    const limit = PLAN_LIMITS[candidate][feature];
    if (limit > current) return candidate;
  }
  return null;
}

/** Cheapest plan whose boolean flag is enabled, at or above `startingAfter`. */
function cheapestPlanEnabling(
  feature: FeatureGate,
  startingAfter: PlanKey,
): PlanKey | null {
  const currentIndex = PLAN_ORDER.indexOf(startingAfter);
  for (let i = currentIndex + 1; i < PLAN_ORDER.length; i += 1) {
    const candidate = PLAN_ORDER[i];
    if (PLAN_LIMITS[candidate][feature]) return candidate;
  }
  return null;
}

/**
 * Thrown when a tenant has reached a plan quota or lacks a plan capability.
 *
 * The detail is embedded in `message` as JSON because server actions cross a
 * serialisation boundary: Next.js preserves only `message`/`digest`, so a plain
 * class field would be lost by the time the client sees it. `readPlanLimitDetail`
 * recovers it. Keep both sides in sync.
 */
export class PlanLimitError extends Error {
  readonly code = PLAN_LIMIT_CODE;

  constructor(readonly detail: PlanLimitDetail) {
    super(`${SERIALISED_PREFIX}${JSON.stringify(detail)}`);
    this.name = "PlanLimitError";
  }
}

export interface QuotaCheckInput {
  plan: PlanKey;
  feature: QuotaFeature;
  /** Current usage for this tenant, already scoped to the tenant. */
  current: number;
}

/**
 * Throws `PlanLimitError` when `current` has reached the plan's ceiling.
 *
 * `current` must already be tenant-scoped — this guard deliberately does not
 * query anything, so it can be used against any repo and cannot accidentally
 * count across tenants.
 *
 * Boundary is `>=`: a tenant with `maxTeams: 4` may hold 4 teams but not create a
 * 5th.
 */
export function checkPlanLimit(input: QuotaCheckInput): void {
  const { plan, feature, current } = input;
  const limits: PlanLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const allowed = limits[feature];

  if (!Number.isInteger(current) || current < 0) {
    throw new TypeError(
      `checkPlanLimit: \`current\` must be a non-negative integer for ${feature}, got ${current}`,
    );
  }

  if (!Number.isFinite(allowed)) return; // unlimited on this plan

  if (current >= allowed) {
    const suggestedPlan = cheapestPlanAllowingMore(feature, current, plan);
    throw new PlanLimitError({
      code: PLAN_LIMIT_CODE,
      feature,
      current,
      allowed,
      currentPlan: plan,
      // Fall back to the current plan when nothing is strictly better, so the
      // field is always a real plan rather than null.
      suggestedPlan: suggestedPlan ?? plan,
      message: suggestedPlan
        ? `Your ${plan} plan allows a maximum of ${allowed} ${humanise(feature)}. ` +
          `You are using ${current}. Upgrade to ${suggestedPlan} to add more.`
        : `Your ${plan} plan allows a maximum of ${allowed} ${humanise(feature)}. ` +
          `You are using ${current}. Contact us to raise this limit.`,
    });
  }
}

export interface FeatureCheckInput {
  plan: PlanKey;
  feature: FeatureGate;
  /** Shown in the error message, e.g. "Live streaming". */
  label?: string;
}

/**
 * Throws `PlanLimitError` when the plan does not include a boolean capability.
 *
 * Same error type as the quota guard so the UI has a single branch to handle.
 */
export function checkPlanFeature(input: FeatureCheckInput): void {
  const { plan, feature } = input;
  const limits: PlanLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  if (limits[feature]) return;

  const suggestedPlan = cheapestPlanEnabling(feature, plan);
  const label = input.label ?? humanise(feature);

  throw new PlanLimitError({
    code: PLAN_LIMIT_CODE,
    feature,
    current: 0,
    allowed: 0,
    currentPlan: plan,
    suggestedPlan: suggestedPlan ?? plan,
    message: suggestedPlan
      ? `${label} is not included in the ${plan} plan. Upgrade to ${suggestedPlan} to use it.`
      : `${label} is not included in the ${plan} plan. Contact us to enable it.`,
  });
}

/**
 * True when the thrown value represents a plan restriction.
 *
 * Matches on the message prefix rather than `instanceof`, which does not survive
 * the server-action boundary.
 */
export function isPlanLimitError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.startsWith(SERIALISED_PREFIX)
  );
}

/**
 * Recovers the structured detail from a thrown error, or `null` if it was some
 * other failure. Safe to call on anything.
 */
export function readPlanLimitDetail(err: unknown): PlanLimitDetail | null {
  if (!isPlanLimitError(err)) return null;
  const message = (err as { message: string }).message;
  const json = message.slice(SERIALISED_PREFIX.length);
  try {
    const parsed = JSON.parse(json) as PlanLimitDetail;
    return parsed?.code === PLAN_LIMIT_CODE ? parsed : null;
  } catch {
    return null;
  }
}

function humanise(feature: QuotaFeature | FeatureGate): string {
  const labels: Record<QuotaFeature | FeatureGate, string> = {
    maxTeams: "teams",
    maxPlayers: "players",
    whiteLabel: "white-label branding",
    customDomain: "custom domains",
    liveStreaming: "live streaming",
  };
  return labels[feature] ?? feature;
}
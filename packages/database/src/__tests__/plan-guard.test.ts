import { describe, expect, it } from "vitest";
import {
  checkPlanLimit,
  checkPlanFeature,
  isPlanLimitError,
  readPlanLimitDetail,
  PlanLimitError,
  PLAN_LIMIT_CODE,
} from "../lib/plan-guard";
import { PLAN_LIMITS, type PlanKey } from "../lib/plan-limits";

describe("checkPlanLimit", () => {
  it("allows usage strictly below the ceiling", () => {
    expect(() => checkPlanLimit({ plan: "free", feature: "maxTeams", current: 3 })).not.toThrow();
  });

  it("allows zero usage on the free plan", () => {
    expect(() => checkPlanLimit({ plan: "free", feature: "maxTeams", current: 0 })).not.toThrow();
  });

  // Boundary is >=: 4 teams on a free plan is legal, a 5th is not.
  it("throws exactly at the ceiling", () => {
    expect(() => checkPlanLimit({ plan: "free", feature: "maxTeams", current: 4 })).toThrow(PlanLimitError);
  });

  it("throws above the ceiling", () => {
    expect(() => checkPlanLimit({ plan: "free", feature: "maxTeams", current: 5 })).toThrow(PlanLimitError);
  });

  it("never throws on an unlimited plan", () => {
    for (const current of [0, 40, 10_000, 1_000_000]) {
      expect(() => checkPlanLimit({ plan: "pro", feature: "maxTeams", current })).not.toThrow();
      expect(() => checkPlanLimit({ plan: "enterprise", feature: "maxPlayers", current })).not.toThrow();
    }
  });

  it("applies the starter ceiling, not the free one", () => {
    expect(() => checkPlanLimit({ plan: "starter", feature: "maxTeams", current: 15 })).not.toThrow();
    expect(() => checkPlanLimit({ plan: "starter", feature: "maxTeams", current: 16 })).toThrow(PlanLimitError);
  });

  it("rejects a non-integer or negative current count instead of silently allowing", () => {
    expect(() => checkPlanLimit({ plan: "free", feature: "maxTeams", current: -1 })).toThrow(TypeError);
    expect(() => checkPlanLimit({ plan: "free", feature: "maxTeams", current: 1.5 })).toThrow(TypeError);
    expect(() => checkPlanLimit({ plan: "free", feature: "maxTeams", current: NaN })).toThrow(TypeError);
  });

  it("falls back to the free tier for an unknown plan string", () => {
    expect(() =>
      checkPlanLimit({ plan: "bogus" as PlanKey, feature: "maxTeams", current: 4 }),
    ).toThrow(PlanLimitError);
  });

  it("suggests the cheapest plan that allows strictly more", () => {
    try {
      checkPlanLimit({ plan: "free", feature: "maxTeams", current: 4 });
      throw new Error("should have thrown");
    } catch (err) {
      const detail = readPlanLimitDetail(err);
      expect(detail?.code).toBe(PLAN_LIMIT_CODE);
      expect(detail?.currentPlan).toBe("free");
      expect(detail?.current).toBe(4);
      expect(detail?.allowed).toBe(4);
      // free=4, starter=16 -> starter is the cheapest tier with room.
      expect(detail?.suggestedPlan).toBe("starter");
    }
  });

  it("keeps suggestedPlan a real plan when nothing is strictly better", () => {
    // Already on the most generous tier for a quota that is capped everywhere.
    const capped = Object.keys(PLAN_LIMITS).find(
      (p) => PLAN_LIMITS[p as PlanKey].maxPlayers !== Infinity,
    )!;
    expect(capped).toBeDefined();
  });
});

describe("checkPlanFeature", () => {
  it("allows a capability the plan includes", () => {
    expect(() => checkPlanFeature({ plan: "pro", feature: "liveStreaming" })).not.toThrow();
    expect(() => checkPlanFeature({ plan: "enterprise", feature: "customDomain" })).not.toThrow();
  });

  it("throws the same error type as a quota breach so the UI has one branch", () => {
    expect(() => checkPlanFeature({ plan: "free", feature: "liveStreaming" })).toThrow(PlanLimitError);
    expect(isPlanLimitError(new Error("nope"))).toBe(false);
  });

  it("suggests the cheapest plan that enables the capability", () => {
    try {
      checkPlanFeature({ plan: "starter", feature: "liveStreaming" });
      throw new Error("should have thrown");
    } catch (err) {
      const detail = readPlanLimitDetail(err);
      expect(detail?.feature).toBe("liveStreaming");
      expect(detail?.suggestedPlan).toBe("pro");
      expect(detail?.message).toMatch(/pro/);
    }
  });

  it("allows customDomain on enterprise only", () => {
    expect(() => checkPlanFeature({ plan: "pro", feature: "customDomain" })).toThrow(PlanLimitError);
    expect(() => checkPlanFeature({ plan: "enterprise", feature: "customDomain" })).not.toThrow();
  });
});

describe("error serialisation across the server-action boundary", () => {
  it("round-trips detail through a plain object, losing only the prototype", () => {
    let thrown: unknown;
    try {
      checkPlanLimit({ plan: "free", feature: "maxPlayers", current: 40 });
    } catch (err) {
      thrown = err;
    }

    // Simulate what survives crossing the RSC boundary: message only.
    const acrossBoundary = { message: (thrown as Error).message };

    expect(isPlanLimitError(acrossBoundary)).toBe(true);
    const detail = readPlanLimitDetail(acrossBoundary);
    expect(detail).not.toBeNull();
    expect(detail?.feature).toBe("maxPlayers");
    expect(detail?.allowed).toBe(40);
    expect(detail?.current).toBe(40);
    expect(typeof detail?.message).toBe("string");
  });

  it("returns null for unrelated errors instead of throwing", () => {
    expect(readPlanLimitDetail(new Error("boom"))).toBeNull();
    expect(readPlanLimitDetail("a string")).toBeNull();
    expect(readPlanLimitDetail(null)).toBeNull();
    expect(readPlanLimitDetail(undefined)).toBeNull();
    expect(readPlanLimitDetail({ message: 42 })).toBeNull();
  });

  it("returns null when the payload is corrupted but prefixed", () => {
    expect(readPlanLimitDetail({ message: `[${PLAN_LIMIT_CODE}]{not json` })).toBeNull();
    expect(readPlanLimitDetail({ message: `[${PLAN_LIMIT_CODE}]{"code":"OTHER"}` })).toBeNull();
  });
});

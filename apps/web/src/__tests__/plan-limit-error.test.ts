import { describe, expect, it } from "vitest";
import {
  checkPlanLimit,
  checkPlanFeature,
  PlanLimitError,
  PLAN_LIMIT_CODE,
} from "@mtk/database";
import { resolveActionError } from "@/lib/plan-limit-error";

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

describe("resolveActionError", () => {
  it("surfaces a quota breach as a clean message with no wire payload", () => {
    const err = thrownBy(() =>
      checkPlanLimit({ plan: "free", feature: "maxTeams", current: 4 }),
    );
    const resolved = resolveActionError(err, "Failed");

    expect(resolved.planLimit).not.toBeNull();
    expect(resolved.planLimit?.code).toBe(PLAN_LIMIT_CODE);
    expect(resolved.planLimit?.feature).toBe("maxTeams");
    expect(resolved.planLimit?.allowed).toBe(4);
    expect(resolved.message).toMatch(/free plan/i);
    expect(resolved.message).toMatch(/starter/i);
  });

  it("never leaks the JSON payload or the marker prefix into the message", () => {
    for (const thrown of [
      thrownBy(() => checkPlanLimit({ plan: "free", feature: "maxPlayers", current: 40 })),
      thrownBy(() => checkPlanFeature({ plan: "free", feature: "liveStreaming" })),
    ]) {
      const { message } = resolveActionError(thrown, "Failed");
      expect(message).not.toContain(PLAN_LIMIT_CODE);
      expect(message).not.toContain("[PLAN_LIMIT");
      expect(message).not.toContain("{");
      expect(message).not.toContain("}");
    }
  });

  it("handles a feature gate and names the plan that enables it", () => {
    const err = thrownBy(() =>
      checkPlanFeature({ plan: "starter", feature: "liveStreaming" }),
    );
    const resolved = resolveActionError(err, "Failed");

    expect(resolved.planLimit?.suggestedPlan).toBe("pro");
    expect(resolved.message).toMatch(/live streaming/i);
  });

  it("still works after the error crosses the RSC boundary as a plain object", () => {
    const original = thrownBy(() =>
      checkPlanLimit({ plan: "free", feature: "maxTeams", current: 4 }),
    ) as Error;
    const acrossBoundary = { message: original.message };

    const resolved = resolveActionError(acrossBoundary, "Failed");
    expect(resolved.planLimit).not.toBeNull();
    expect(resolved.message).not.toContain("[PLAN_LIMIT");
  });

  it("passes ordinary errors through unchanged and marks them non-plan", () => {
    const resolved = resolveActionError(new Error("Match not found"), "Failed");
    expect(resolved.planLimit).toBeNull();
    expect(resolved.message).toBe("Match not found");
  });

  it("falls back when the thrown value carries no usable message", () => {
    expect(resolveActionError(undefined, "Failed")).toEqual({
      message: "Failed",
      planLimit: null,
    });
    expect(resolveActionError(null, "Failed").message).toBe("Failed");
    expect(resolveActionError("a string", "Failed").message).toBe("Failed");
    expect(resolveActionError({ message: 42 }, "Failed").message).toBe("Failed");
  });

  it("degrades to the fallback if the prefix ever survives unparseable", () => {
    const resolved = resolveActionError(
      { message: "[PLAN_LIMIT_REACHED]{oops" },
      "Failed to create team",
    );
    expect(resolved.planLimit).toBeNull();
    expect(resolved.message).toBe("Failed to create team");
  });

  it("treats a hand-thrown PlanLimitError the same as a wire payload", () => {
    const err = new PlanLimitError({
      code: PLAN_LIMIT_CODE,
      feature: "maxTeams",
      current: 4,
      allowed: 4,
      currentPlan: "free",
      suggestedPlan: "starter",
      message: "custom copy",
    });
    const resolved = resolveActionError(err, "Failed");
    expect(resolved.planLimit?.message).toBe("custom copy");
  });
});
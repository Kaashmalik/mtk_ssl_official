import { describe, expect, it } from "vitest";
import {
  CAPABILITIES_SCHEMA_VERSION,
  CAPABILITY_KEYS,
  EMPTY_CAPABILITIES,
  hasCapability,
  parseCapabilities,
} from "../capabilities";

/**
 * ENH-03-01: the client capability vocabulary. Servers advertise what a
 * client may rely on; native and web read the SAME names. Unknown keys are
 * refused (a typo must not read as "supported").
 */

describe("ENH-03-01: capability vocabulary", () => {
  it("is versioned and names the approved capability set", () => {
    expect(CAPABILITIES_SCHEMA_VERSION).toBe(1);
    expect(CAPABILITY_KEYS).toContain("live_scoring_ws");
    expect(CAPABILITY_KEYS).toContain("offline_ball_queue");
    expect(CAPABILITY_KEYS).toContain("scoring_recovery");
    expect(CAPABILITY_KEYS).toContain("push_notifications");
  });

  it("parses a real advertisement and refuses unknown keys", () => {
    const parsed = parseCapabilities({
      version: 1,
      capabilities: { live_scoring_ws: true, offline_ball_queue: false },
    });
    expect(parsed.capabilities.live_scoring_ws).toBe(true);

    expect(() =>
      parseCapabilities({ version: 1, capabilities: { mind_readng: true } } as never),
    ).toThrow();
    expect(() => parseCapabilities({ version: 2, capabilities: {} })).toThrow();
  });

  it("defaults every capability to false and reads missing keys as absent", () => {
    for (const key of CAPABILITY_KEYS) {
      expect(EMPTY_CAPABILITIES.capabilities[key]).toBe(false);
    }
    expect(hasCapability(EMPTY_CAPABILITIES, "live_scoring_ws")).toBe(false);

    const enabled = parseCapabilities({ version: 1, capabilities: { push_notifications: true } });
    expect(hasCapability(enabled, "push_notifications")).toBe(true);
  });
});

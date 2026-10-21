/**
 * ENH-03-01: the client capability vocabulary.
 *
 * Servers advertise what a client may rely on; web and native read the SAME
 * names. Unknown keys are refused rather than stripped — a typo must never
 * read as "supported", and a renamed capability must break loudly during
 * integration instead of silently disabling a feature.
 */

export const CAPABILITIES_SCHEMA_VERSION = 1;

export const CAPABILITY_KEYS = [
  "live_scoring_ws",
  "offline_ball_queue",
  "scoring_recovery",
  "push_notifications",
  "fan_predictions",
  "fan_polls",
  "video_embeds",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export interface CapabilitiesV1 {
  version: 1;
  capabilities: Record<CapabilityKey, boolean>;
}

function emptyCapabilities(): CapabilitiesV1 {
  const capabilities = {} as Record<CapabilityKey, boolean>;
  for (const key of CAPABILITY_KEYS) capabilities[key] = false;
  return { version: 1, capabilities };
}

/** Every capability off — the safe default for an unreachable server. */
export const EMPTY_CAPABILITIES: CapabilitiesV1 = emptyCapabilities();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validates an advertisement; refuses unknown keys and foreign versions. */
export function parseCapabilities(input: unknown): CapabilitiesV1 {
  const record = isRecord(input) ? input : null;
  if (!record || record.version !== CAPABILITIES_SCHEMA_VERSION) {
    throw new Error(`Capabilities must be version ${CAPABILITIES_SCHEMA_VERSION}`);
  }
  const offered = isRecord(record.capabilities) ? record.capabilities : null;
  if (!offered) throw new Error("Capabilities must carry a capabilities record");
  const capabilities = {} as Record<CapabilityKey, boolean>;
  for (const key of CAPABILITY_KEYS) {
    const value = offered[key];
    if (value !== undefined && typeof value !== "boolean") {
      throw new Error(`Capability ${key} must be a boolean`);
    }
    capabilities[key] = value === true;
  }
  for (const key of Object.keys(offered)) {
    if (!CAPABILITY_KEYS.includes(key as CapabilityKey)) {
      throw new Error(`Unknown capability: ${key}`);
    }
  }
  return { version: 1, capabilities };
}

/** Reads a capability; an absent key is simply off. */
export function hasCapability(capabilities: CapabilitiesV1, key: CapabilityKey): boolean {
  return capabilities.capabilities[key] === true;
}

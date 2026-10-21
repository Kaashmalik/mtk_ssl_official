/**
 * ENH-08-01/02: portable broadcast ownership and lifecycle contracts.
 *
 * `desired` is what the league operator asked for. `observed` is what the
 * provider last confirmed. They are separate columns and must never be
 * collapsed: a prepared request is not "live", and a live badge is only
 * truthful when the provider-observed state is live.
 *
 * Pure+zod only. Provider credentials, transport and database access belong to
 * server adapters behind these decisions.
 */

export const BROADCAST_PROVIDER_VALUES = ["youtube", "facebook"] as const
export type BroadcastProvider = (typeof BROADCAST_PROVIDER_VALUES)[number]

export const BROADCAST_DESIRED_STATE_VALUES = [
  "draft",
  "preparing",
  "ready",
  "starting",
  "live",
  "ending",
  "ended",
  "failed",
  "cancelled",
] as const
export type BroadcastDesiredState = (typeof BROADCAST_DESIRED_STATE_VALUES)[number]

export const BROADCAST_OBSERVED_STATE_VALUES = [
  "unconfigured",
  "provisioning",
  "ready",
  "live",
  "interrupted",
  "ending",
  "processing",
  "replay_ready",
  "failed",
  "ended",
] as const
export type BroadcastObservedState = (typeof BROADCAST_OBSERVED_STATE_VALUES)[number]

export const BROADCAST_DESTINATION_KIND_VALUES = ["channel", "playlist", "page"] as const
export type BroadcastDestinationKind = (typeof BROADCAST_DESTINATION_KIND_VALUES)[number]

export const BROADCAST_ACTION_VALUES = [
  "none",
  "prepare",
  "start",
  "end",
  "reconcile",
  "mark_ready",
  "mark_live",
  "mark_ended",
  "fail",
] as const
export type BroadcastAction = (typeof BROADCAST_ACTION_VALUES)[number]

export type BroadcastReconcileDecision = {
  action: BroadcastAction
  nextDesired: BroadcastDesiredState
  reason: string
}

/**
 * Reconcile intent against provider truth.
 *
 * The decision never promotes `starting` to live on its own. Only an observed
 * `live` can produce `mark_live`; a lost provider response produces
 * `reconcile`, not a second create/start. Ending is idempotent: repeated
 * endings keep asking the provider until it reports processing/ended.
 */
export function broadcastReconcileDecision(input: {
  desired: BroadcastDesiredState
  observed: BroadcastObservedState
  providerTerminal?: boolean
}): BroadcastReconcileDecision {
  const { desired, observed } = input
  if (observed === "failed" || input.providerTerminal) {
    return { action: "fail", nextDesired: "failed", reason: "provider_failed" }
  }

  switch (desired) {
    case "draft":
      return { action: "none", nextDesired: "draft", reason: "not_requested" }

    case "preparing":
      if (observed === "ready") {
        return { action: "mark_ready", nextDesired: "ready", reason: "provider_ready" }
      }
      if (observed === "provisioning") {
        return { action: "none", nextDesired: "preparing", reason: "provider_provisioning" }
      }
      if (observed === "unconfigured") {
        return { action: "prepare", nextDesired: "preparing", reason: "provider_unconfigured" }
      }
      return { action: "reconcile", nextDesired: "preparing", reason: "unexpected_provider_state" }

    case "ready":
      if (observed === "ready") {
        return { action: "none", nextDesired: "ready", reason: "provider_ready" }
      }
      if (observed === "live") {
        return { action: "mark_live", nextDesired: "live", reason: "provider_already_live" }
      }
      if (observed === "unconfigured") {
        return { action: "prepare", nextDesired: "preparing", reason: "provider_lost" }
      }
      return { action: "reconcile", nextDesired: "ready", reason: "unexpected_provider_state" }

    case "starting":
      if (observed === "live") {
        return { action: "mark_live", nextDesired: "live", reason: "provider_live" }
      }
      if (observed === "provisioning" || observed === "ready" || observed === "interrupted") {
        return { action: "none", nextDesired: "starting", reason: "provider_not_live_yet" }
      }
      if (observed === "unconfigured") {
        return { action: "prepare", nextDesired: "preparing", reason: "provider_missing" }
      }
      return { action: "reconcile", nextDesired: "starting", reason: "uncertain_start" }

    case "live":
      if (observed === "live") {
        return { action: "none", nextDesired: "live", reason: "provider_live" }
      }
      if (observed === "processing" || observed === "replay_ready" || observed === "ended") {
        return { action: "mark_ended", nextDesired: "ended", reason: "provider_ended" }
      }
      if (observed === "interrupted" || observed === "ending") {
        return { action: "reconcile", nextDesired: "live", reason: "provider_interrupted" }
      }
      return { action: "reconcile", nextDesired: "live", reason: "provider_state_unknown" }

    case "ending":
      if (observed === "ending" || observed === "processing" || observed === "replay_ready" || observed === "ended") {
        return { action: "mark_ended", nextDesired: "ended", reason: "provider_ended" }
      }
      if (observed === "live" || observed === "interrupted") {
        return { action: "end", nextDesired: "ending", reason: "retry_end" }
      }
      return { action: "reconcile", nextDesired: "ending", reason: "uncertain_end" }

    case "ended":
      if (observed === "live" || observed === "interrupted") {
        return { action: "end", nextDesired: "ending", reason: "provider_still_live" }
      }
      return { action: "none", nextDesired: "ended", reason: "ended" }

    case "failed":
    case "cancelled":
      if (observed === "live" || observed === "interrupted" || observed === "ending") {
        return { action: "end", nextDesired: desired, reason: "stop_provider_output" }
      }
      return { action: "none", nextDesired: desired, reason: desired }

    default:
      return { action: "reconcile", nextDesired: desired, reason: "unknown_desired_state" }
  }
}

/** Public badge truth: only provider-observed live is live. */
export type BroadcastPublicState = "upcoming" | "live" | "replay" | "unavailable"

export function broadcastPublicState(input: {
  desired: BroadcastDesiredState
  observed: BroadcastObservedState
  playbackAvailable: boolean
}): BroadcastPublicState {
  if (input.observed === "live") return "live"
  if (input.observed === "replay_ready" && input.playbackAvailable) return "replay"
  if (
    input.observed === "provisioning"
    || input.observed === "ready"
    || input.observed === "ending"
    || input.observed === "processing"
    || input.desired === "preparing"
    || input.desired === "ready"
    || input.desired === "starting"
  ) {
    return "upcoming"
  }
  return "unavailable"
}

// ---------------------------------------------------------------------------
// Ownership and destinations
// ---------------------------------------------------------------------------

export function broadcastDestinationDecision(input: {
  requestTenantId: string
  connectionTenantId: string
  connectionProvider: BroadcastProvider
  destinationProvider: BroadcastProvider
  connectionStatus: "active" | "expired" | "revoked"
  destinationActive: boolean
  destinationKind: BroadcastDestinationKind
  provider: BroadcastProvider
}): { allowed: true } | { allowed: false; reason: string } {
  if (input.requestTenantId !== input.connectionTenantId) {
    return { allowed: false, reason: "foreign_connection" }
  }
  if (input.connectionStatus !== "active") {
    return { allowed: false, reason: "connection_inactive" }
  }
  if (input.connectionProvider !== input.provider || input.destinationProvider !== input.provider) {
    return { allowed: false, reason: "provider_mismatch" }
  }
  if (!input.destinationActive) return { allowed: false, reason: "destination_inactive" }
  const kinds: Record<BroadcastProvider, readonly BroadcastDestinationKind[]> = {
    youtube: ["channel", "playlist"],
    facebook: ["page"],
  }
  if (!kinds[input.provider].includes(input.destinationKind)) {
    return { allowed: false, reason: "destination_kind_mismatch" }
  }
  return { allowed: true }
}

/** One exclusive ingest lease; expiry fences a dead/old worker without rewrites. */
export function broadcastLeaseDecision(input: {
  now: Date
  requesterId: string
  ownerId: string | null
  expiresAt: Date | null
}): { granted: true; expiresAt: Date } | { granted: false; reason: "held" } {
  const held = input.ownerId !== null && input.expiresAt !== null && input.expiresAt > input.now
  if (held && input.ownerId !== input.requesterId) {
    return { granted: false, reason: "held" }
  }
  return {
    granted: true,
    expiresAt: new Date(input.now.getTime() + 30_000),
  }
}

/** Provider status is an allowlist, never free text from a response. */
export function broadcastObservedFromProvider(
  provider: BroadcastProvider,
  raw: string,
): BroadcastObservedState | null {
  const normalized = raw.trim().toLowerCase()
  if (provider === "youtube") {
    const map: Record<string, BroadcastObservedState> = {
      created: "provisioning",
      ready: "ready",
      testing: "provisioning",
      live: "live",
      live_starting: "provisioning",
      complete: "ended",
      completed: "ended",
      revoked: "failed",
      failed: "failed",
    }
    return map[normalized] ?? null
  }
  const map: Record<string, BroadcastObservedState> = {
    unpublished: "provisioning",
    scheduled_live: "provisioning",
    live_now: "live",
    live_stopped: "ended",
    vod: "processing",
    processing: "processing",
    ready: "replay_ready",
    error: "failed",
  }
  return map[normalized] ?? null
}

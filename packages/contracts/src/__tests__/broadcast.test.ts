import { describe, expect, it } from "vitest"
import {
  broadcastDestinationDecision,
  broadcastLeaseDecision,
  broadcastObservedFromProvider,
  broadcastPublicState,
  broadcastReconcileDecision,
} from "../broadcast"

/**
 * ENH-08-01/02: provider truth and ownership.
 *
 * These pins keep the dishonest combinations out: a prepared request can never
 * become live without provider observation, uncertain responses reconcile
 * instead of recreating, and a destination cannot cross tenant/provider.
 */

describe("ENH-08-02: desired versus observed lifecycle", () => {
  it("never invents live from a started request", () => {
    expect(broadcastReconcileDecision({
      desired: "starting", observed: "provisioning",
    })).toMatchObject({ action: "none", nextDesired: "starting" })

    expect(broadcastReconcileDecision({
      desired: "starting", observed: "live",
    })).toMatchObject({ action: "mark_live", nextDesired: "live" })
  })

  it("reconciles a lost start response instead of creating another broadcast", () => {
    expect(broadcastReconcileDecision({
      desired: "starting", observed: "ready",
    })).toMatchObject({ action: "none" })
    expect(broadcastReconcileDecision({
      desired: "starting", observed: "interrupted",
    })).toMatchObject({ action: "none" })
  })

  it("keeps ending idempotent until the provider is processing/ended", () => {
    expect(broadcastReconcileDecision({
      desired: "ending", observed: "live",
    })).toMatchObject({ action: "end", nextDesired: "ending" })
    expect(broadcastReconcileDecision({
      desired: "ending", observed: "processing",
    })).toMatchObject({ action: "mark_ended", nextDesired: "ended" })
  })

  it("treats provider failure as terminal, not as a retry loop", () => {
    expect(broadcastReconcileDecision({
      desired: "live", observed: "failed",
    })).toEqual({ action: "fail", nextDesired: "failed", reason: "provider_failed" })
  })

  it("stops output when a cancelled session was already live", () => {
    expect(broadcastReconcileDecision({
      desired: "cancelled", observed: "live",
    })).toMatchObject({ action: "end" })
  })

  it("maps provider statuses through an allowlist", () => {
    expect(broadcastObservedFromProvider("youtube", "live")).toBe("live")
    expect(broadcastObservedFromProvider("youtube", "complete")).toBe("ended")
    expect(broadcastObservedFromProvider("facebook", "LIVE_NOW")).toBe("live")
    expect(broadcastObservedFromProvider("facebook", "arbitrary")).toBeNull()
  })

  it("only publishes a live badge for observed live or a real replay", () => {
    expect(broadcastPublicState({
      desired: "live", observed: "live", playbackAvailable: true,
    })).toBe("live")
    expect(broadcastPublicState({
      desired: "live", observed: "provisioning", playbackAvailable: false,
    })).toBe("upcoming")
    expect(broadcastPublicState({
      desired: "ended", observed: "replay_ready", playbackAvailable: true,
    })).toBe("replay")
    expect(broadcastPublicState({
      desired: "ended", observed: "replay_ready", playbackAvailable: false,
    })).toBe("unavailable")
  })
})

describe("ENH-08-01: ownership, destination and lease", () => {
  const base = {
    requestTenantId: "00000000-0000-4000-8000-0000000000a1",
    connectionTenantId: "00000000-0000-4000-8000-0000000000a1",
    connectionProvider: "youtube" as const,
    destinationProvider: "youtube" as const,
    connectionStatus: "active" as const,
    destinationActive: true,
    destinationKind: "playlist" as const,
    provider: "youtube" as const,
  }

  it("allows only same-tenant, active, provider-matching destinations", () => {
    expect(broadcastDestinationDecision(base)).toEqual({ allowed: true })
    expect(broadcastDestinationDecision({
      ...base, requestTenantId: "00000000-0000-4000-8000-0000000000a2",
    })).toEqual({ allowed: false, reason: "foreign_connection" })
    expect(broadcastDestinationDecision({
      ...base, connectionStatus: "expired",
    })).toEqual({ allowed: false, reason: "connection_inactive" })
    expect(broadcastDestinationDecision({
      ...base, destinationProvider: "facebook",
    })).toEqual({ allowed: false, reason: "provider_mismatch" })
    expect(broadcastDestinationDecision({
      ...base, destinationKind: "page",
    })).toEqual({ allowed: false, reason: "destination_kind_mismatch" })
  })

  it("fences a held ingest lease but lets the same worker renew", () => {
    const now = new Date("2026-10-21T10:00:00Z")
    expect(broadcastLeaseDecision({
      now,
      requesterId: "worker-b",
      ownerId: "worker-a",
      expiresAt: new Date(now.getTime() + 10_000),
    })).toEqual({ granted: false, reason: "held" })

    expect(broadcastLeaseDecision({
      now,
      requesterId: "worker-a",
      ownerId: "worker-a",
      expiresAt: new Date(now.getTime() + 10_000),
    })).toMatchObject({ granted: true })

    expect(broadcastLeaseDecision({
      now,
      requesterId: "worker-b",
      ownerId: "worker-a",
      expiresAt: new Date(now.getTime() - 1),
    })).toMatchObject({ granted: true })
  })
})

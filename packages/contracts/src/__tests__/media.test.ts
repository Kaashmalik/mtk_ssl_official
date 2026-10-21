import { describe, expect, it } from "vitest"
import {
  MEDIA_CONTRACT_VERSION,
  classifyLegacyMedia,
  mediaBindingDecision,
  mediaCleanupDecision,
  mediaCleanupIsTerminal,
  mediaDeliveryDecision,
  mediaPublicationDecision,
  mediaUploadLimitDecision,
  type MediaLimits,
} from "../media"

const LIMITS: MediaLimits = {
  image: { maxBytes: 10_000, allowedMimeTypes: ["image/png", "image/jpeg"] },
  video: { maxBytes: 100_000, allowedMimeTypes: ["video/mp4"], maxDurationSeconds: 120 },
}

describe("ENH-07-01: media contract vocabulary", () => {
  it("is versioned", () => {
    expect(MEDIA_CONTRACT_VERSION).toBe(1)
  })

  it("classifies every pre-contract asset as unverified and unpublished", () => {
    const legacy = classifyLegacyMedia()
    expect(legacy.state).toBe("legacy_unverified")
    expect(legacy.publication).toBe("unpublished")
    expect(legacy.needsAuthoritativeRecheck).toBe(true)
    // A legacy URL is never a delivery credential.
    expect(mediaDeliveryDecision({ state: legacy.state, publication: legacy.publication, audience: "public" }))
      .toEqual({ allowed: false })
    expect(mediaDeliveryDecision({ state: legacy.state, publication: legacy.publication, audience: "member" }))
      .toEqual({ allowed: false })
  })
})

describe("ENH-07-01: upload limits refuse before signing", () => {
  it("refuses when the deployment has no approved limits", () => {
    expect(mediaUploadLimitDecision({ kind: "image", mimeType: "image/png", bytes: 1 }, null))
      .toEqual({ allowed: false, reason: "limits_unconfigured" })
    expect(mediaUploadLimitDecision({ kind: "image", mimeType: "image/png", bytes: 1 }, {}))
      .toEqual({ allowed: false, reason: "limits_unconfigured" })
  })

  it("checks kind, MIME, byte ceiling and declared duration", () => {
    const base = { kind: "image" as const, mimeType: "IMAGE/PNG", bytes: 5_000 }
    expect(mediaUploadLimitDecision(base, LIMITS)).toEqual({ allowed: true })
    expect(mediaUploadLimitDecision({ ...base, mimeType: "image/svg+xml" }, LIMITS))
      .toEqual({ allowed: false, reason: "mime_not_allowed" })
    expect(mediaUploadLimitDecision({ ...base, bytes: 10_001 }, LIMITS))
      .toEqual({ allowed: false, reason: "too_large" })
    expect(mediaUploadLimitDecision({ ...base, bytes: 0 }, LIMITS))
      .toEqual({ allowed: false, reason: "too_large" })

    expect(mediaUploadLimitDecision({ kind: "video", mimeType: "video/mp4", bytes: 50_000 }, LIMITS))
      .toEqual({ allowed: false, reason: "duration_unbounded" })
    expect(mediaUploadLimitDecision({
      kind: "video", mimeType: "video/mp4", bytes: 50_000, durationSeconds: 121,
    }, LIMITS)).toEqual({ allowed: false, reason: "duration_too_long" })
    expect(mediaUploadLimitDecision({
      kind: "video", mimeType: "video/mp4", bytes: 50_000, durationSeconds: 120,
    }, LIMITS)).toEqual({ allowed: true })
    expect(mediaUploadLimitDecision({ kind: "audio", mimeType: "audio/mpeg", bytes: 10 }, LIMITS))
      .toEqual({ allowed: false, reason: "limits_unconfigured" })
  })
})

describe("ENH-07-01: same-tenant bindings", () => {
  const base = {
    requestTenantId: "tenant-a",
    assetTenantId: "tenant-a",
    resourceTenantId: "tenant-a",
    assetState: "ready" as const,
  }

  it("allows a ready asset bound inside one tenant", () => {
    expect(mediaBindingDecision(base)).toEqual({ allowed: true })
  })

  it("refuses a foreign asset, a missing tenant and a foreign resource", () => {
    expect(mediaBindingDecision({ ...base, assetTenantId: "tenant-b" }))
      .toEqual({ allowed: false, reason: "foreign_tenant" })
    expect(mediaBindingDecision({ ...base, assetTenantId: null }))
      .toEqual({ allowed: false, reason: "foreign_tenant" })
    expect(mediaBindingDecision({ ...base, resourceTenantId: "tenant-b" }))
      .toEqual({ allowed: false, reason: "resource_tenant_mismatch" })
    expect(mediaBindingDecision({ ...base, resourceTenantId: null }))
      .toEqual({ allowed: false, reason: "resource_tenant_mismatch" })
  })

  it("refuses unready or quarantined assets even in the right tenant", () => {
    expect(mediaBindingDecision({ ...base, assetState: "processing" }))
      .toEqual({ allowed: false, reason: "asset_not_ready" })
    expect(mediaBindingDecision({ ...base, assetState: "legacy_unverified" }))
      .toEqual({ allowed: false, reason: "asset_not_ready" })
    expect(mediaBindingDecision({ ...base, assetState: "quarantined" }))
      .toEqual({ allowed: false, reason: "asset_quarantined" })
  })
})

describe("ENH-07-01: publication requires readiness AND settled consent", () => {
  it("publishes only a ready asset with not_required/granted consent", () => {
    expect(mediaPublicationDecision({ state: "ready", consent: "not_required", publication: "unpublished" }))
      .toEqual({ allowed: true })
    expect(mediaPublicationDecision({ state: "ready", consent: "granted", publication: "unpublished" }))
      .toEqual({ allowed: true })
  })

  it("refuses non-ready, quarantined, pending and withdrawn consent", () => {
    expect(mediaPublicationDecision({ state: "processing", consent: "granted", publication: "unpublished" }))
      .toEqual({ allowed: false, reason: "asset_not_ready" })
    expect(mediaPublicationDecision({ state: "quarantined", consent: "granted", publication: "unpublished" }))
      .toEqual({ allowed: false, reason: "asset_quarantined" })
    expect(mediaPublicationDecision({ state: "ready", consent: "pending", publication: "unpublished" }))
      .toEqual({ allowed: false, reason: "consent_pending" })
    expect(mediaPublicationDecision({ state: "ready", consent: "withdrawn", publication: "unpublished" }))
      .toEqual({ allowed: false, reason: "consent_withdrawn" })
    expect(mediaPublicationDecision({ state: "ready", consent: "granted", publication: "withdrawn" }))
      .toEqual({ allowed: false, reason: "already_withdrawn" })
  })
})

describe("ENH-07-01: delivery and cleanup", () => {
  it("delivers publicly only ready+published; operators can inspect non-deleted states", () => {
    expect(mediaDeliveryDecision({ state: "ready", publication: "published", audience: "public" }))
      .toEqual({ allowed: true })
    expect(mediaDeliveryDecision({ state: "ready", publication: "unpublished", audience: "public" }))
      .toEqual({ allowed: false })
    expect(mediaDeliveryDecision({ state: "processing", publication: "published", audience: "member" }))
      .toEqual({ allowed: false })
    expect(mediaDeliveryDecision({ state: "quarantined", publication: "published", audience: "operator" }))
      .toEqual({ allowed: true })
    expect(mediaDeliveryDecision({ state: "deleted", publication: "published", audience: "operator" }))
      .toEqual({ allowed: false })
  })

  it("queues provider destruction on delete/quarantine/withdrawal but preserves identity", () => {
    expect(mediaCleanupDecision({ beforeState: "ready", afterState: "deleted", consent: "granted" }))
      .toEqual({
        required: true,
        actions: ["destroy_provider_asset", "invalidate_delivery"],
        preserveProviderIdentity: true,
      })
    expect(mediaCleanupDecision({ beforeState: "processing", afterState: "quarantined", consent: "pending" }))
      .toMatchObject({ required: true, preserveProviderIdentity: true })
    expect(mediaCleanupDecision({ beforeState: "ready", afterState: "ready", consent: "withdrawn" }))
      .toMatchObject({ required: true })
    expect(mediaCleanupDecision({ beforeState: "pending", afterState: "failed", consent: "granted" }))
      .toEqual({ required: false })
  })

  it("treats only confirmed destruction / dead-letter / cap as terminal", () => {
    expect(mediaCleanupIsTerminal({ state: "provider_destroyed", attempts: 0, maxAttempts: 8 })).toBe(true)
    expect(mediaCleanupIsTerminal({ state: "dead_lettered", attempts: 8, maxAttempts: 8 })).toBe(true)
    expect(mediaCleanupIsTerminal({ state: "pending", attempts: 8, maxAttempts: 8 })).toBe(true)
    expect(mediaCleanupIsTerminal({ state: "leased", attempts: 8, maxAttempts: 8 })).toBe(false)
    expect(mediaCleanupIsTerminal({ state: "pending", attempts: 1, maxAttempts: 8 })).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { buildMediaLimits, mediaUploadLimitDecision } from "@/lib/media-policy"

/**
 * ENH-07-01: deployment limits are explicit and fail closed.
 *
 * No provider quota is approved yet. A missing/partial setting must produce
 * `limits_unconfigured` refusal, never an unlimited upload.
 */
describe("ENH-07-01: media limit settings", () => {
  it("leaves every kind unconfigured when nothing is approved", () => {
    expect(buildMediaLimits({})).toEqual({})
    expect(mediaUploadLimitDecision({ kind: "image", mimeType: "image/png", bytes: 1 }, buildMediaLimits({})))
      .toEqual({ allowed: false, reason: "limits_unconfigured" })
  })

  it("parses a complete image/video rule and normalizes MIME casing", () => {
    const limits = buildMediaLimits({
      image: { maxBytes: "10000", allowedMimeTypes: "image/PNG, image/jpeg" },
      video: { maxBytes: 100000, allowedMimeTypes: "video/mp4", maxDurationSeconds: "120" },
    })
    expect(limits.image).toEqual({ maxBytes: 10_000, allowedMimeTypes: ["image/png", "image/jpeg"] })
    expect(limits.video).toEqual({ maxBytes: 100_000, allowedMimeTypes: ["video/mp4"], maxDurationSeconds: 120 })
    expect(mediaUploadLimitDecision({ kind: "image", mimeType: "image/png", bytes: 5_000 }, limits))
      .toEqual({ allowed: true })
  })

  it("omits a partially configured kind instead of inventing a ceiling", () => {
    const limits = buildMediaLimits({
      image: { maxBytes: 10_000 },
      video: { allowedMimeTypes: "video/mp4", maxDurationSeconds: 120 },
      audio: { maxBytes: "not-a-number", allowedMimeTypes: "audio/mpeg" },
    })
    expect(limits).toEqual({})
  })
})

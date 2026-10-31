import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import {
  buildUploadAuthorization,
  cloudinaryResourceType,
  fetchProviderAsset,
  mimeTypeForFormat,
  privateDeliveryUrl,
  publicDeliveryUrl,
  signCloudinaryParams,
  validateProviderAsset,
  verifyCloudinaryResponseSignature,
  type ProviderAsset,
} from "@/lib/media-provider"

/**
 * ENH-07-02: provider adapter.
 *
 * These pin the parts that decide whether forged upload metadata can become an
 * approved asset: deterministic signing, defensive authoritative reads and a
 * validation gate that treats every unverifiable field as quarantine.
 */

const CONFIG = { cloudName: "ssl-test", apiKey: "key", apiSecret: "secret" }
const RULE = {
  maxBytes: 10_000,
  allowedMimeTypes: ["image/png", "image/jpeg"],
}

function asset(overrides: Partial<ProviderAsset> = {}): ProviderAsset {
  return {
    assetId: "asset-1",
    publicId: "ssl_abc",
    version: 17,
    resourceType: "image",
    deliveryType: "upload",
    format: "png",
    bytes: 4_000,
    width: 800,
    height: 600,
    durationSeconds: null,
    secureUrl: "https://res.cloudinary.com/ssl-test/image/upload/v17/ssl_abc.png",
    createdAt: "2026-10-21T10:00:00Z",
    ...overrides,
  }
}

describe("ENH-07-02: Cloudinary request signing", () => {
  it("sorts signed parameters, excludes URL/transport fields and appends the secret", () => {
    const params = {
      timestamp: 1_700_000_000,
      public_id: "ssl_abc",
      overwrite: "false",
      type: "upload",
      api_key: "key",
      resource_type: "image",
      cloud_name: "ssl-test",
    }
    const expected = createHash("sha1")
      .update("overwrite=false&public_id=ssl_abc&timestamp=1700000000&type=uploadsecret")
      .digest("hex")
    expect(signCloudinaryParams(params, "secret")).toBe(expected)
  })

  it("issues one signed request with a server-owned public id and a short session", () => {
    const result = buildUploadAuthorization({
      config: CONFIG,
      kind: "image",
      publicId: "ssl_abc",
      declaredBytes: 4_000,
      allowedFormats: ["png", "jpg"],
      now: new Date("2026-10-21T10:00:00Z"),
    })
    expect(result.uploadUrl).toBe("https://api.cloudinary.com/v1_1/ssl-test/image/upload")
    expect(result.params).toMatchObject({
      public_id: "ssl_abc",
      timestamp: "1792576800",
      overwrite: "false",
      // Originals are private until the app decides to serve them.
      type: "authenticated",
      max_file_size: "4000",
      allowed_formats: "png,jpg",
      api_key: "key",
    })
    expect(result.params.signature).toBe(
      signCloudinaryParams(result.params, CONFIG.apiSecret),
    )
    expect(result.expiresAt.toISOString()).toBe("2026-10-21T10:15:00.000Z")
  })

  it("verifies upload response signatures in constant-time comparison form", () => {
    const signature = createHash("sha1").update("public_id=ssl_abc&version=17secret").digest("hex")
    expect(verifyCloudinaryResponseSignature({
      publicId: "ssl_abc", version: 17, signature, apiSecret: "secret",
    })).toBe(true)
    expect(verifyCloudinaryResponseSignature({
      publicId: "ssl_abc", version: 18, signature, apiSecret: "secret",
    })).toBe(false)
    expect(verifyCloudinaryResponseSignature({
      publicId: "ssl_abc", version: 17, signature: "not-hex", apiSecret: "secret",
    })).toBe(false)
  })

  it("maps audio to Cloudinary's video resource type", () => {
    expect(cloudinaryResourceType("image")).toBe("image")
    expect(cloudinaryResourceType("video")).toBe("video")
    expect(cloudinaryResourceType("audio")).toBe("video")
  })
})

describe("ENH-07-02: authoritative provider read", () => {
  it("reads only after a successful JSON response and normalizes safe fields", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      asset_id: "asset-1", public_id: "ssl_abc", version: 17,
      resource_type: "image", type: "upload", format: "png", bytes: 4_000,
      width: 800, height: 600, secure_url: "https://res.cloudinary.com/x",
      created_at: "2026-10-21T10:00:00Z",
    }), { status: 200 }))
    const result = await fetchProviderAsset({
      config: CONFIG, publicId: "ssl_abc", kind: "image", fetchImpl: fetchImpl as any,
    })
    expect(result).toEqual({
      ok: true,
      asset: {
        assetId: "asset-1", publicId: "ssl_abc", version: 17,
        resourceType: "image", deliveryType: "upload", format: "png", bytes: 4_000,
        width: 800, height: 600, durationSeconds: null,
        secureUrl: "https://res.cloudinary.com/x", createdAt: "2026-10-21T10:00:00Z",
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cloudinary.com/v1_1/ssl-test/resources/image/authenticated/ssl_abc",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("falls back to the public delivery type only when no private original exists", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes("/authenticated/")
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify({
        public_id: "ssl_abc", resource_type: "image", type: "upload", format: "png",
      }), { status: 200 }))
    const result = await fetchProviderAsset({
      config: CONFIG, publicId: "ssl_abc", kind: "image", fetchImpl: fetchImpl as any,
    })
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toContain("/resources/image/upload/ssl_abc")
  })

  it("distinguishes not-found, outage and malformed answers", async () => {
    const notFound = await fetchProviderAsset({
      config: CONFIG, publicId: "ssl_abc", kind: "image",
      fetchImpl: (async () => new Response("", { status: 404 })) as any,
    })
    expect(notFound).toEqual({ ok: false, reason: "provider_not_found" })

    const outage = await fetchProviderAsset({
      config: CONFIG, publicId: "ssl_abc", kind: "image",
      fetchImpl: (async () => { throw new Error("network") }) as any,
    })
    expect(outage).toEqual({ ok: false, reason: "provider_unavailable" })

    const malformed = await fetchProviderAsset({
      config: CONFIG, publicId: "ssl_abc", kind: "image",
      fetchImpl: (async () => new Response("{}", { status: 200 })) as any,
    })
    expect(malformed).toEqual({ ok: false, reason: "provider_invalid_response" })
  })
})

describe("ENH-07-02: finalize validation is a ceiling, not a trust fall", () => {
  const base = {
    expectedPublicId: "ssl_abc",
    kind: "image" as const,
    declaredMimeType: "image/png",
    declaredBytes: 5_000,
    rule: RULE,
  }

  it("accepts only authoritative values inside both the declaration and the limit", () => {
    expect(validateProviderAsset({ ...base, asset: asset() })).toEqual({
      ok: true, bytes: 4_000, mimeType: "image/png", format: "png",
      width: 800, height: 600, durationSeconds: null,
    })
  })

  it("refuses a different provider public id, resource type or delivery type", () => {
    expect(validateProviderAsset({ ...base, asset: asset({ publicId: "other" }) }))
      .toEqual({ ok: false, reason: "public_id_mismatch" })
    expect(validateProviderAsset({ ...base, asset: asset({ resourceType: "video" }) }))
      .toEqual({ ok: false, reason: "resource_type_mismatch" })
    expect(validateProviderAsset({ ...base, asset: asset({ deliveryType: "private" }) }))
      .toEqual({ ok: false, reason: "untrusted_delivery_type" })
  })

  it("accepts the private delivery type that new uploads are signed with", () => {
    expect(validateProviderAsset({ ...base, asset: asset({ deliveryType: "authenticated" }) }).ok)
      .toBe(true)
  })

  it("refuses unknown formats and a format different from the declaration", () => {
    expect(validateProviderAsset({ ...base, asset: asset({ format: "exe" }) }))
      .toEqual({ ok: false, reason: "unknown_format" })
    expect(validateProviderAsset({ ...base, asset: asset({ format: "gif" }) }))
      .toEqual({ ok: false, reason: "format_not_allowed" })
    expect(validateProviderAsset({
      ...base, declaredMimeType: "image/jpeg", asset: asset({ format: "png" }),
    })).toEqual({ ok: false, reason: "mime_mismatch" })
  })

  it("refuses missing, over-declared and over-limit byte counts", () => {
    expect(validateProviderAsset({ ...base, asset: asset({ bytes: null }) }))
      .toEqual({ ok: false, reason: "bytes_unverifiable" })
    expect(validateProviderAsset({ ...base, declaredBytes: 3_999, asset: asset() }))
      .toEqual({ ok: false, reason: "bytes_exceed_declared" })
    expect(validateProviderAsset({
      ...base,
      declaredBytes: 20_000,
      rule: { ...RULE, maxBytes: 3_000 },
      asset: asset(),
    })).toEqual({ ok: false, reason: "bytes_exceed_limit" })
  })

  it("requires a verifiable duration for timed media and enforces the limit", () => {
    const videoRule = {
      maxBytes: 10_000, allowedMimeTypes: ["video/mp4"], maxDurationSeconds: 60,
    }
    const video = asset({
      resourceType: "video", format: "mp4", durationSeconds: 30,
      publicId: "ssl_abc",
    })
    expect(validateProviderAsset({
      ...base, kind: "video", declaredMimeType: "video/mp4", rule: videoRule, asset: video,
    }).ok).toBe(true)
    expect(validateProviderAsset({
      ...base, kind: "video", declaredMimeType: "video/mp4", rule: videoRule,
      asset: { ...video, durationSeconds: null },
    })).toEqual({ ok: false, reason: "duration_unverifiable" })
    expect(validateProviderAsset({
      ...base, kind: "video", declaredMimeType: "video/mp4", rule: videoRule,
      asset: { ...video, durationSeconds: 61 },
    })).toEqual({ ok: false, reason: "duration_exceeds_limit" })
  })
})

describe("ENH-07-02: delivery identity", () => {
  it("builds a URL from verified provider identity, not a client string", () => {
    expect(publicDeliveryUrl({
      config: CONFIG, kind: "image", format: "png", publicId: "ssl_abc", version: 17,
    })).toBe("https://res.cloudinary.com/ssl-test/image/upload/v17/ssl_abc.png")
  })

  it("mints a short-lived signed private download URL from verified identity", () => {
    const url = new URL(privateDeliveryUrl({
      config: CONFIG, kind: "image", format: "png", publicId: "ssl_abc",
      now: new Date("2026-10-21T10:00:00Z"),
    }))
    expect(url.origin + url.pathname).toBe("https://api.cloudinary.com/v1_1/ssl-test/image/download")
    const query = Object.fromEntries(url.searchParams)
    expect(query).toMatchObject({
      public_id: "ssl_abc", format: "png", type: "authenticated", api_key: "key",
      timestamp: "1792576800", expires_at: "1792576920", attachment: "false",
    })
    const { signature, api_key: _apiKey, ...signed } = query
    expect(signature).toBe(signCloudinaryParams(signed, CONFIG.apiSecret))
  })

  it("maps known provider formats and refuses unknown ones", () => {
    expect(mimeTypeForFormat("JPG")).toBe("image/jpeg")
    expect(mimeTypeForFormat("mp4")).toBe("video/mp4")
    expect(mimeTypeForFormat("exe")).toBeNull()
  })
})

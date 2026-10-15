import { describe, expect, it } from "vitest"
import {
  MAX_PROOF_NAME_LENGTH,
  paymentProofStoragePath,
  sanitizeReceiptName,
  sniffImageMime,
} from "@/lib/payment-proof"

const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03])
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const gifBytes = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const webpBytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00])

describe("receipt MIME sniffing is the content authority", () => {
  it("recognizes JPEG, PNG, GIF and WebP magic bytes", () => {
    expect(sniffImageMime(jpegBytes)).toBe("image/jpeg")
    expect(sniffImageMime(pngBytes)).toBe("image/png")
    expect(sniffImageMime(gifBytes)).toBe("image/gif")
    expect(sniffImageMime(webpBytes)).toBe("image/webp")
  })

  it("rejects truncated and non-image content", () => {
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8]))).toBeNull() // truncated JPEG header
    expect(sniffImageMime(new Uint8Array(16).fill(0x41))).toBeNull() // plain bytes
    // RIFF without WEBP marker is not WebP.
    const riffOnly = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x58, 0x58, 0x58, 0x58])
    expect(sniffImageMime(riffOnly)).toBeNull()
  })
})

describe("receipt filenames are sanitized to safe storage basenames", () => {
  it("neutralizes path separators and hostile characters", () => {
    expect(sanitizeReceiptName("../../.env")).toBe(".._.._.env")
    expect(sanitizeReceiptName("a/b\\c.png")).toBe("a_b_c.png")
    // Non-ASCII names collapse to the safe alphabet with the extension intact.
    const sanitized = sanitizeReceiptName("صور-الإيصال.png")
    expect(sanitized.endsWith(".png")).toBe(true)
    expect(sanitized).toMatch(/^[a-zA-Z0-9._-]+$/)
  })

  it("caps the stored name length", () => {
    const long = sanitizeReceiptName("a".repeat(300))
    expect(long.length).toBe(MAX_PROOF_NAME_LENGTH)
  })

  it("namespaces the path under the uploader's id", () => {
    const path = paymentProofStoragePath("clerk-1", 1_760_000_000_000, sanitizeReceiptName("my receipt.png"))
    expect(path).toBe("receipts/clerk-1/1760000000000_my_receipt.png")
    expect(path).not.toContain("..")
  })
})

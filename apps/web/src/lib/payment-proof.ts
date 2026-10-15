/**
 * Payment-proof (receipt) upload primitives. Pure helpers are exported for
 * regression tests: the magic-byte sniff is the content-type authority (the
 * declared multipart type is only a hint), and the stored name is sanitized
 * so a hostile filename cannot traverse or smuggle characters into storage.
 */

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])

export const MAX_PROOF_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
export const MAX_PROOF_NAME_LENGTH = 120
export const PROOF_SIGNED_URL_SECONDS = 60 * 60 * 24 * 7 // 7 days for admin review
export const PROOF_BUCKET = "payment-proofs"

/** Detect the image type from magic bytes; null when unrecognized. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

/** Flatten a hostile filename to a safe storage basename. */
export function sanitizeReceiptName(name: string, max = MAX_PROOF_NAME_LENGTH): string {
  return name
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, max)
}

export function paymentProofStoragePath(userId: string, timestamp: number, safeName: string): string {
  return `receipts/${userId}/${timestamp}_${safeName || "receipt"}`
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import type { BroadcastIngest } from "./broadcast-provider"

/**
 * ENH-08-01/02: server-side credential references and ingest secret handling.
 *
 * `broadcast_connections.credential_ref` stores only an opaque reference such
 * as `secret://SSL_YOUTUBE_BROADCAST_TOKEN`. The actual token is read from the
 * deployment's secret store (here represented by an allowlisted environment
 * variable) and is never written to a table, an audit row, a client response or
 * a log. The allowlist prevents a compromised connection row from naming an
 * unrelated environment variable.
 *
 * Ingest keys returned by a provider are encrypted with AES-256-GCM before they
 * reach `broadcast_sessions.ingest_secret_ref`. The session id is bound as
 * additional authenticated data, so a ciphertext cannot be moved to another
 * session.
 */

export class BroadcastCredentialError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = "BroadcastCredentialError"
    this.code = code
  }
}

export type ResolvedBroadcastCredential = {
  accessToken: string
  expiresAt: Date | null
}

export function broadcastCredentialsReady(): boolean {
  return process.env.BROADCAST_CREDENTIALS_READY === "true"
}

function allowedCredentialNames(): Set<string> {
  const raw = process.env.BROADCAST_CREDENTIAL_NAMES ?? ""
  return new Set(raw.split(",").map(value => value.trim()).filter(Boolean))
}

export function resolveBroadcastCredential(reference: string): ResolvedBroadcastCredential {
  if (!broadcastCredentialsReady()) throw new BroadcastCredentialError("credentials_unconfigured")
  const match = /^(?:env|secret):\/\/([A-Z][A-Z0-9_]{2,80})$/.exec(reference.trim())
  if (!match) throw new BroadcastCredentialError("credentials_reference_invalid")
  const name = match[1]
  if (!allowedCredentialNames().has(name)) throw new BroadcastCredentialError("credentials_reference_not_allowed")

  const raw = process.env[name]
  if (!raw) throw new BroadcastCredentialError("credentials_unavailable")

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BroadcastCredentialError("credentials_unreadable")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BroadcastCredentialError("credentials_unreadable")
  }
  const record = parsed as Record<string, unknown>
  const accessToken = typeof record.accessToken === "string" ? record.accessToken.trim() : ""
  if (accessToken.length < 8 || accessToken.length > 8192) {
    throw new BroadcastCredentialError("credentials_unreadable")
  }
  const expiresAt = typeof record.expiresAt === "string" ? new Date(record.expiresAt) : null
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
    throw new BroadcastCredentialError("credentials_expired")
  }
  return { accessToken, expiresAt }
}

function ingestKey(): Buffer {
  const raw = process.env.BROADCAST_INGEST_ENCRYPTION_KEY ?? ""
  const bytes = Buffer.from(raw, "base64")
  if (bytes.length !== 32 || bytes.toString("base64") !== raw) {
    throw new BroadcastCredentialError("ingest_key_unconfigured")
  }
  return bytes
}

export function broadcastIngestEncryptionReady(): boolean {
  try {
    ingestKey()
    return true
  } catch {
    return false
  }
}

export function encryptBroadcastIngest(sessionId: string, ingest: BroadcastIngest): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", ingestKey(), iv)
  cipher.setAAD(Buffer.from(`broadcast-ingest:${sessionId}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(ingest), "utf8"), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString("base64")).join(".")
}

export function decryptBroadcastIngest(sessionId: string, encrypted: string): BroadcastIngest {
  const parts = encrypted.split(".")
  if (parts.length !== 3) throw new BroadcastCredentialError("ingest_unreadable")
  const [iv, tag, ciphertext] = parts.map(value => Buffer.from(value, "base64"))
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new BroadcastCredentialError("ingest_unreadable")
  }
  const decipher = createDecipheriv("aes-256-gcm", ingestKey(), iv)
  decipher.setAAD(Buffer.from(`broadcast-ingest:${sessionId}`))
  decipher.setAuthTag(tag)
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"))
  } catch {
    throw new BroadcastCredentialError("ingest_unreadable")
  }
  const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
  const rtmpUrl = typeof record?.rtmpUrl === "string" ? record.rtmpUrl : ""
  const streamKey = typeof record?.streamKey === "string" ? record.streamKey : ""
  if (!rtmpUrl || !streamKey) throw new BroadcastCredentialError("ingest_unreadable")
  return { rtmpUrl, streamKey }
}

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  BroadcastCredentialError,
  broadcastIngestEncryptionReady,
  decryptBroadcastIngest,
  encryptBroadcastIngest,
  resolveBroadcastCredential,
} from "@/lib/broadcast-credentials"

/**
 * ENH-08-01/02: secret references stay opaque and ingest keys stay bound to
 * their session. Nothing here reads a real provider credential.
 */

const SESSION = "00000000-0000-4000-8000-0000000000a1"

beforeEach(() => {
  process.env.BROADCAST_CREDENTIALS_READY = "true"
  process.env.BROADCAST_CREDENTIAL_NAMES = "SSL_YOUTUBE_BROADCAST_TOKEN"
  process.env.SSL_YOUTUBE_BROADCAST_TOKEN = JSON.stringify({
    accessToken: "provider-token-value",
    expiresAt: "2099-01-01T00:00:00Z",
  })
  process.env.BROADCAST_INGEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
})

afterEach(() => {
  for (const key of [
    "BROADCAST_CREDENTIALS_READY", "BROADCAST_CREDENTIAL_NAMES",
    "SSL_YOUTUBE_BROADCAST_TOKEN", "BROADCAST_INGEST_ENCRYPTION_KEY",
  ]) delete process.env[key]
})

describe("ENH-08-01: provider credential references", () => {
  it("resolves only an allowlisted opaque reference", () => {
    expect(resolveBroadcastCredential("secret://SSL_YOUTUBE_BROADCAST_TOKEN"))
      .toMatchObject({ accessToken: "provider-token-value" })
  })

  it("refuses a connection row that names an unrelated environment variable", () => {
    expect(() => resolveBroadcastCredential("env://DATABASE_URL"))
      .toThrow(BroadcastCredentialError)
    expect(() => resolveBroadcastCredential("plaintext-token"))
      .toThrow(BroadcastCredentialError)
  })

  it("refuses an expired or unreadable token bundle", () => {
    process.env.SSL_YOUTUBE_BROADCAST_TOKEN = JSON.stringify({
      accessToken: "provider-token-value",
      expiresAt: "2020-01-01T00:00:00Z",
    })
    expect(() => resolveBroadcastCredential("secret://SSL_YOUTUBE_BROADCAST_TOKEN"))
      .toThrow(BroadcastCredentialError)

    process.env.SSL_YOUTUBE_BROADCAST_TOKEN = "not-json"
    expect(() => resolveBroadcastCredential("secret://SSL_YOUTUBE_BROADCAST_TOKEN"))
      .toThrow(BroadcastCredentialError)
  })

  it("claims nothing when the credential gate is off", () => {
    delete process.env.BROADCAST_CREDENTIALS_READY
    expect(() => resolveBroadcastCredential("secret://SSL_YOUTUBE_BROADCAST_TOKEN"))
      .toThrow(BroadcastCredentialError)
  })
})

describe("ENH-08-02: ingest encryption", () => {
  it("round-trips an ingest key without exposing it in the ciphertext", () => {
    const encrypted = encryptBroadcastIngest(SESSION, {
      rtmpUrl: "rtmps://live.example/rtmp",
      streamKey: "stream-key-value",
    })
    expect(encrypted).not.toContain("stream-key-value")
    expect(decryptBroadcastIngest(SESSION, encrypted)).toEqual({
      rtmpUrl: "rtmps://live.example/rtmp",
      streamKey: "stream-key-value",
    })
  })

  it("refuses ciphertext moved to another session", () => {
    const encrypted = encryptBroadcastIngest(SESSION, {
      rtmpUrl: "rtmps://live.example/rtmp",
      streamKey: "stream-key-value",
    })
    expect(() => decryptBroadcastIngest("00000000-0000-4000-8000-0000000000a2", encrypted))
      .toThrow(BroadcastCredentialError)
  })

  it("fails closed without a canonical 32-byte key", () => {
    delete process.env.BROADCAST_INGEST_ENCRYPTION_KEY
    expect(broadcastIngestEncryptionReady()).toBe(false)
    expect(() => encryptBroadcastIngest(SESSION, {
      rtmpUrl: "rtmps://live.example/rtmp", streamKey: "key",
    })).toThrow(BroadcastCredentialError)
  })
})

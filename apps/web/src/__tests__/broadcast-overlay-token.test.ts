import { describe, expect, it } from "vitest"
import {
  signBroadcastOverlayToken,
  verifyBroadcastOverlayToken,
} from "@/lib/broadcast-overlay-token"

/** ENH-09-01: overlay capability rotation, expiry and tamper resistance. */

const SECRET = "x".repeat(48)
const TENANT = "00000000-0000-4000-8000-0000000000a1"
const MATCH = "00000000-0000-4000-8000-0000000000b1"
const NOW = new Date("2026-10-21T10:00:00Z")

describe("ENH-09-01: overlay token", () => {
  it("binds exactly one tenant/match until expiry", () => {
    const token = signBroadcastOverlayToken({
      tenantId: TENANT, matchId: MATCH, ttlSeconds: 3_600, now: NOW,
    }, SECRET)
    expect(verifyBroadcastOverlayToken(token, SECRET, NOW)).toMatchObject({
      tenantId: TENANT, matchId: MATCH,
    })
    expect(verifyBroadcastOverlayToken(
      token, SECRET, new Date(NOW.getTime() + 3_601_000),
    )).toBeNull()
  })

  it("rejects tampering, a rotated secret and malformed tokens", () => {
    const token = signBroadcastOverlayToken({
      tenantId: TENANT, matchId: MATCH, now: NOW,
    }, SECRET)
    const [version, payload, signature] = token.split(".")
    expect(verifyBroadcastOverlayToken(
      `${version}.${payload}.${signature?.slice(0, -1)}A`, SECRET, NOW,
    )).toBeNull()
    expect(verifyBroadcastOverlayToken(token, "y".repeat(48), NOW)).toBeNull()
    expect(verifyBroadcastOverlayToken("v1", SECRET, NOW)).toBeNull()
    expect(verifyBroadcastOverlayToken(token, "short", NOW)).toBeNull()
  })

  it("refuses an unbounded or non-positive TTL", () => {
    expect(() => signBroadcastOverlayToken({
      tenantId: TENANT, matchId: MATCH, ttlSeconds: 0, now: NOW,
    }, SECRET)).toThrow()
    expect(() => signBroadcastOverlayToken({
      tenantId: TENANT, matchId: MATCH, ttlSeconds: 60 * 60 * 24, now: NOW,
    }, SECRET)).toThrow()
  })
})

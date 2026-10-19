import { describe, expect, it, vi, afterEach } from "vitest"

/**
 * Batch 159 privileged-session (IAM-08) and invitation outbox (IAM-04)
 * primitives. Pure logic only: session policy parsing, AES-GCM round trip,
 * envelope binding, and retry backoff bounds. Provider HTTP is never tested
 * here — that requires a real sandbox (REL-02 gate).
 */

import { hasRecentSecondFactor, PRIVILEGED_FACTOR_MAX_AGE_MINUTES } from "@mtk/database/lib/privileged-session-policy"

describe("privileged session second-factor policy (IAM-08)", () => {
  it("accepts both factors freshly verified inside the window", () => {
    expect(hasRecentSecondFactor({ fva: [0, 2] })).toBe(true)
    expect(hasRecentSecondFactor({ fva: [PRIVILEGED_FACTOR_MAX_AGE_MINUTES, PRIVILEGED_FACTOR_MAX_AGE_MINUTES] })).toBe(true)
  })

  it("rejects a stale second factor", () => {
    expect(hasRecentSecondFactor({ fva: [0, PRIVILEGED_FACTOR_MAX_AGE_MINUTES + 1] })).toBe(false)
  })

  it("rejects first-factor fallback, single factor, and malformed claims", () => {
    expect(hasRecentSecondFactor({ fva: [0] })).toBe(false)
    expect(hasRecentSecondFactor({ fva: [0, -1] })).toBe(false)
    expect(hasRecentSecondFactor({})).toBe(false)
    expect(hasRecentSecondFactor(null)).toBe(false)
    expect(hasRecentSecondFactor("fva" as unknown)).toBe(false)
  })
})

import { encryptInvitationMail, decryptInvitationMail } from "@/lib/invitation-mail-crypto"

const BINDING = JSON.stringify(["tenant-1", "invite-1", "a".repeat(64)])

function useKey(raw: string) {
  vi.stubEnv("INVITATION_EMAIL_ENCRYPTION_KEY", raw)
}

afterEach(() => vi.unstubAllEnvs())

describe("invitation mail envelope (IAM-04)", () => {
  it("round trips the message only under the identical tenant/invite/token binding", () => {
    useKey("NWY0ZWUzNTZkN2I4OWMwYTFiMmMzZDRlNWY2YTdiOGM=") // base64 of 32 bytes
    const message = { to: "player@example.com", subject: "League invite", text: "Your link: https://x.test/t" }
    const sealed = encryptInvitationMail(message, BINDING)
    expect(sealed).not.toContain("player@example.com")
    expect(decryptInvitationMail(sealed, BINDING)).toEqual(message)
  })

  it("refuses a different binding (tampered tenant/invite/token association)", () => {
    useKey("NWY0ZWUzNTZkN2I4OWMwYTFiMmMzZDRlNWY2YTdiOGM=")
    const sealed = encryptInvitationMail({ to: "p@e.com", subject: "s", text: "t" }, BINDING)
    expect(() => decryptInvitationMail(sealed, JSON.stringify(["tenant-2", "invite-1", "a".repeat(64)]))).toThrow()
  })

  it("fails closed on a non-canonical or wrong-length key", () => {
    useKey("not-base64!!")
    expect(() => encryptInvitationMail({}, BINDING)).toThrow(/canonical base64 32-byte/)
    useKey("c2hvcnQ=")
    expect(() => encryptInvitationMail({}, BINDING)).toThrow()
  })
})

import { invitationRetryDelay } from "@/lib/invitation-email-queue"

describe("invitation dispatch retry bounds (IAM-04)", () => {
  it("ramps the delay up to a capped hourly retry and refuses out-of-range attempts", () => {
    expect(invitationRetryDelay(1)).toBe(5_000)
    expect(invitationRetryDelay(4)).toBe(600_000)
    expect(invitationRetryDelay(8)).toBe(3_600_000)
    expect(() => invitationRetryDelay(0)).toThrow()
    expect(() => invitationRetryDelay(9)).toThrow()
    expect(() => invitationRetryDelay(1.5)).toThrow()
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { assertSupportedInvitationScope, hasVerifiedInvitedEmail, invitationBaseUrl, invitationToken } from "@/lib/invitation-policy"
afterEach(() => vi.unstubAllEnvs())
const TEAM = "00000000-0000-4000-8000-000000000001"
describe("Invitation policy", () => {
  it("matches only a verified provider email on the exact session identity, including non-primary email", () => {
    expect(hasVerifiedInvitedEmail({ id: "user", emailAddresses: [
      { emailAddress: "primary@example.test", verification: { status: "verified" } },
      { emailAddress: "Invited@Example.Test", verification: { status: "verified" } },
    ] }, "user", " invited@example.test ")).toBe(true)
  })
  it.each([null, "unverified", "failed", "expired"]) ("verification status %s is not accepted", status => {
    expect(hasVerifiedInvitedEmail({ id: "user", emailAddresses: [{ emailAddress: "invited@example.test", verification: { status } }] }, "user", "invited@example.test")).toBe(false)
  })
  it("does not collapse aliases or names to merge identities", () => {
    expect(hasVerifiedInvitedEmail({ id: "user", emailAddresses: [{ emailAddress: "ali@example.test", verification: { status: "verified" } }] }, "user", "ali+scorer@example.test")).toBe(false)
  })
  it.each(["super_admin", "league_owner", "fan", "unknown"])("cannot invite privilege %s", role => {
    expect(() => assertSupportedInvitationScope(role, null)).toThrow()
  })
  // REG-05 (Batch 134): player joined the invitable roles (league scope only,
  // roster assignment stays in the roster flows), captain is team-required.
  it.each(["scorer", "coach", "player"])("%s only supports league scope, not misleading team grants", role => {
    expect(() => assertSupportedInvitationScope(role, null)).not.toThrow()
    expect(() => assertSupportedInvitationScope(role, TEAM)).toThrow("not supported")
  })
  it.each([null, "not-a-uuid"])("captain invitation requires a team (batch 134, got %s)", teamId => {
    expect(() => assertSupportedInvitationScope("captain", teamId as string | null)).toThrow("requires a team")
    expect(() => assertSupportedInvitationScope("captain", TEAM)).not.toThrow()
  })
  it("manager requires a valid UUID team", () => {
    expect(() => assertSupportedInvitationScope("team_manager", TEAM)).not.toThrow()
    expect(() => assertSupportedInvitationScope("team_manager", null)).toThrow()
    expect(() => assertSupportedInvitationScope("team_manager", "team")).toThrow()
  })
  it("bounds tokens to the existing 256-bit base64url format", () => {
    expect(invitationToken.safeParse("a".repeat(43)).success).toBe(true)
    expect(invitationToken.safeParse("a".repeat(44)).success).toBe(false)
  })
  it.each(["javascript:alert(1)", "https://user:password@example.test", "https://example.test/path", "https://example.test?redirect=x", "https://example.test#secret"])("refuses unsafe/non-origin URL %s before issuing", url => {
    vi.stubEnv("WEB_APP_URL", url)
    expect(() => invitationBaseUrl()).toThrow()
  })
  it("production requires an explicitly configured HTTPS origin", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("WEB_APP_URL", ""); vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    expect(() => invitationBaseUrl()).toThrow("Configure")
    vi.stubEnv("WEB_APP_URL", "http://example.test")
    expect(() => invitationBaseUrl()).toThrow("HTTPS")
    vi.stubEnv("WEB_APP_URL", "https://example.test/")
    expect(invitationBaseUrl()).toBe("https://example.test")
  })
})

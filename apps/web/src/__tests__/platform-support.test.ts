import { describe, expect, it } from "vitest"
import {
  buildPlatformSupportMessage,
  buildWhatsAppLink,
  describeSupportTopic,
  PLATFORM_WHATSAPP_DISPLAY,
  PLATFORM_WHATSAPP_LINK_NUMBER,
} from "@/lib/platform-support"

/**
 * ENH-02-04 (privacy-conscious WhatsApp support): the prefill contract is
 * BOUNDS + ALLOWLIST. Only the saved league name/URL/plan, the application
 * reference and the status the USER SEES flow into the draft — never an
 * email, token, OTP, reviewer note or payment document. The WhatsApp URL is
 * built with ONE encoding pass, and must survive Unicode and query-hostile
 * characters without double-encoding or truncation.
 */

describe("platform support contact constants (ENH-02-04)", () => {
  it("points at the approved WhatsApp number with the approved display form", () => {
    expect(PLATFORM_WHATSAPP_LINK_NUMBER).toBe("923038111297")
    expect(PLATFORM_WHATSAPP_DISPLAY).toBe("+92 303 8111297")
  })

  it("every topic has a member-facing sentence", () => {
    for (const topic of ["setup", "apply", "status", "recovery", "billing"] as const) {
      expect(describeSupportTopic(topic).length).toBeGreaterThan(10)
    }
  })
})

describe("prefill message discipline (ENH-02-04)", () => {
  it("includes only the allowlisted saved facts", () => {
    const message = buildPlatformSupportMessage({
      topic: "apply",
      leagueName: "Shakir Super League",
      leagueSlug: "shakir-super-league",
      plan: "pro",
      applicationReference: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      statusLabel: "Information requested",
    })

    expect(message).toContain("Shakir Super League")
    expect(message).toContain("shakir-super-league")
    expect(message).toContain("pro")
    expect(message).toContain("3f2504e0-4f89-41d3-9a0c-0305e82c3301")
    expect(message).toContain("Information requested")
  })

  it("never defaults in secrets or review content even if handed to it", () => {
    const message = buildPlatformSupportMessage({
      topic: "status",
      leagueName: "My League",
      // A hostile/buggy caller: these must be bounded OUT of the allowlist.
      email: "victim@example.com",
      token: "otp-123456",
      reviewerNote: "We suspect fraud in this application",
      paymentDocument: "bank: PK00 XXXX 0000",
    } as never)

    expect(message).not.toContain("victim@example.com")
    expect(message).not.toContain("otp-123456")
    expect(message).not.toContain("fraud")
    expect(message).not.toContain("PK00")
  })

  it("bounds every field and keeps the draft short", () => {
    const message = buildPlatformSupportMessage({
      topic: "setup",
      leagueName: "L".repeat(500),
      statusLabel: "S".repeat(500),
    })

    expect(message.length).toBeLessThanOrEqual(600)
    expect(message).not.toContain("L".repeat(120))
  })

  it("produces a usable draft with no facts at all", () => {
    const message = buildPlatformSupportMessage({ topic: "recovery" })
    expect(message.length).toBeGreaterThan(10)
  })
})

describe("WhatsApp link encoding (ENH-02-04)", () => {
  it("encodes exactly once and survives query-hostile characters", () => {
    const link = buildWhatsAppLink("Plan: pro & more = true #hash +plus")

    expect(link.startsWith("https://wa.me/923038111297?text=")).toBe(true)
    expect(link).toContain("%26") // &
    expect(link).toContain("%3D") // =
    expect(link).toContain("%23") // #
    expect(link).toContain("%2B") // +
    // No double encoding.
    expect(link).not.toContain("%2526")
    expect(link).not.toContain("%2520")
  })

  it("keeps Unicode intact through one encoding pass", () => {
    const link = buildWhatsAppLink("Лига.ylim✓ اسم لیگ")

    const decoded = decodeURIComponent(link.split("?text=")[1] ?? "")
    expect(decoded).toBe("Лига.ylim✓ اسم لیگ")
  })
})

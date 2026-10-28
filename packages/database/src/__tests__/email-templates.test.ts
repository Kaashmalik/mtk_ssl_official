import { describe, expect, it } from "vitest"
import {
  EMAIL_TEMPLATE_LOCALES,
  INVITATION_TEMPLATES,
  VERIFICATION_TEMPLATES,
  ROLE_LABELS,
  normalizeEmailLocale,
  plainEmailLine,
  renderInvitationEmail,
  renderVerificationEmail,
  type EmailLocale,
} from "../lib/email-templates"

const BASE = {
  locale: "en",
  inviterName: "Rashid",
  leagueName: "Dhaka Premier Cup",
  role: "captain",
  link: "https://ssl.example/accept-invite?token=abc",
  expiresDays: 7,
}

describe("email template policy (Batch 144, UX-03 localized emails)", () => {
  it("renders every locale for both templates - key parity across en/bn/ar", () => {
    for (const locale of EMAIL_TEMPLATE_LOCALES) {
      const invite = renderInvitationEmail({ ...BASE, locale })
      expect(invite.subject.length).toBeGreaterThan(0)
      expect(invite.text).toContain(BASE.link)
      expect(invite.text).toContain("7")
      const otp = renderVerificationEmail({ locale, code: "123456", ttlMinutes: 10 })
      expect(otp.subject.length).toBeGreaterThan(0)
      expect(otp.text).toContain("123456")
    }
  })

  it("an unknown or missing locale is honest English, never a wrong language", () => {
    expect(normalizeEmailLocale("fr")).toBe("en")
    expect(normalizeEmailLocale("en-US")).toBe("en")
    expect(normalizeEmailLocale(null)).toBe("en")
    expect(normalizeEmailLocale(undefined)).toBe("en")
    const en = renderInvitationEmail({ ...BASE, locale: "en" })
    expect(renderInvitationEmail({ ...BASE, locale: "fr" }).subject).toBe(en.subject)
  })

  it("the role label is the fixed enum per locale; an unknown role REFUSES", () => {
    const bn = renderInvitationEmail({ ...BASE, locale: "bn" })
    expect(bn.text).toContain("অধিনায়ক")
    expect(() => renderInvitationEmail({ ...BASE, role: "superadmin" })).toThrow(/Unknown invitation role/)
  })

  it("interpolated values cannot inject header or body structure", () => {
    expect(plainEmailLine("Bad\n\nBcc: victim@example.com")).toBe("Bad Bcc: victim@example.com")
    const rendered = renderInvitationEmail({
      ...BASE,
      locale: "en",
      inviterName: "Bad\n\nBcc: victim@example.com",
      leagueName: "League\r\nAccept: evil",
    })
    expect(rendered.subject).not.toMatch(/[\r\n]/)
    // Sanitization FLATTENS, it does not delete: the attacker text survives
    // as one harmless inline line but can no longer forge a header or a
    // paragraph break inside the body.
    expect(rendered.text).not.toContain("\n\nBcc:")
    expect(rendered.text).not.toContain("\n\nAccept: evil")
    expect(rendered.text).toContain("Bad Bcc: victim@example.com")
  })

  it("the verification template interpolates the code without trusting its content", () => {
    const rendered = renderVerificationEmail({ locale: "ar", code: "12\r\n34", ttlMinutes: 10 })
    expect(rendered.text).toContain("12 34")
    expect(rendered.text).toContain("10")
  })

  it("B162 (PREM-02): the subject carries the published brand appName, sanitized, with the platform fallback", () => {
    // Branding reaches ONLY the subject; the approved body copy is untouched.
    const branded = renderInvitationEmail({ ...BASE, locale: "en", appName: "Delta League" })
    expect(branded.subject).toBe(`You have been invited to join ${BASE.leagueName} on Delta League`)
    const fallback = renderInvitationEmail({ ...BASE, locale: "en" })
    expect(fallback.subject).toBe(`You have been invited to join ${BASE.leagueName} on SSL`)
    expect(branded.text).toBe(fallback.text)
    // A hostile appName is flattened - it can never split the subject line.
    const hostile = renderInvitationEmail({ ...BASE, locale: "en", appName: "X\nBcc: victim@x" })
    expect(hostile.subject).not.toMatch(/[\r\n]/)
    expect(hostile.subject).toContain("on X Bcc: victim@x")
  })

  it("Batch 176 (P3c): every locale table has EXACT key parity with en - for functions, slots; for labels, keys", () => {
    // Structure pin: a locale missing (or inventing) a role key or a
    // subject/body slot must fail HERE, not surface as an undefined render
    // in production. en is the reference vocabulary; bn/ar are sets that
    // must stay equal to it, not merely contain it.
    const roleKeysOf = (locale: EmailLocale) =>
      Object.keys(ROLE_LABELS[locale]).sort().join(",")
    for (const locale of EMAIL_TEMPLATE_LOCALES) {
      expect(roleKeysOf(locale), `ROLE_LABELS[${locale}]`).toBe(roleKeysOf("en"))
      for (const role of Object.keys(ROLE_LABELS[locale]) as (keyof typeof ROLE_LABELS["en"])[]) {
        expect(ROLE_LABELS[locale][role].length, `${locale}/${role}`).toBeGreaterThan(0)
      }

      expect(
        Object.keys(INVITATION_TEMPLATES[locale]).sort().join(","),
        `INVITATION_TEMPLATES[${locale}]`,
      ).toBe(Object.keys(INVITATION_TEMPLATES.en).sort().join(","))
      expect(
        Object.keys(VERIFICATION_TEMPLATES[locale]).sort().join(","),
        `VERIFICATION_TEMPLATES[${locale}]`,
      ).toBe(Object.keys(VERIFICATION_TEMPLATES.en).sort().join(","))
    }

    // Slot pin: every locale's slots are callable with the SAME argument
    // shape en uses and yield non-empty strings - a bn/ar body that only
    // compiles because it ignores its variables still renders, so the pin
    // exercises the interpolation end to end.
    const inviteVars = {
      inviterName: "Rashid", leagueName: "Dhaka Premier Cup", roleLabel: "captain",
      link: BASE.link, expiresDays: 7, siteName: "SSL",
    }
    for (const locale of EMAIL_TEMPLATE_LOCALES) {
      const invited = INVITATION_TEMPLATES[locale]
      expect(invited.subject(inviteVars).length).toBeGreaterThan(0)
      expect(invited.body(inviteVars)).toContain(BASE.link)
      expect(invited.body(inviteVars)).toContain("7")
      const otp = VERIFICATION_TEMPLATES[locale]
      expect(otp.subject({ ttlMinutes: 10 }).length).toBeGreaterThan(0)
      expect(otp.body({ ttlMinutes: 10 })).toContain("10")
    }
  })
})

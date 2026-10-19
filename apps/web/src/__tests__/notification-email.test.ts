import { afterEach, describe, expect, it, vi } from "vitest"
import { buildNotificationEmail, notificationEmailFrom, notificationEmailReady } from "@/lib/notification-email"
import { brandPresentation } from "@/lib/brand-presentation"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("notification email template (B161)", () => {
  it("brands subject and signature from the published, validated snapshot only", () => {
    const brand = brandPresentation({ appName: "SSL Super League", primaryColor: "#0ea5e9" })
    const mail = buildNotificationEmail({
      leagueName: "Karachi Premier", title: "Award declared",
      body: "Best Batsman: A. Khan.", brand,
    })
    expect(mail.subject).toBe("SSL Super League: Award declared")
    expect(mail.text).toContain("— Karachi Premier")
    expect(mail.text).toContain("Sent via SSL Super League")
    expect(mail.text).toContain("You are receiving this because you enabled email notifications")
  })

  it("falls back honestly when no branding is published", () => {
    const mail = buildNotificationEmail({ leagueName: "", title: "t", body: "b", brand: null })
    expect(mail.subject.startsWith("SSL Cricket: t")).toBe(true)
    expect(mail.text).toContain("— your league")
  })

  it("never lets control characters from the brand into the email", () => {
    const brand = brandPresentation({ appName: "Evil\nBcc: victim@x" })
    const mail = buildNotificationEmail({ leagueName: "L", title: "t", body: "b", brand })
    // appName control characters are sanitized to spaces upstream, so the
    // subject line can never be split into injected headers.
    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  it("reports channel wiring only when the flag AND provider key are set", () => {
    vi.stubEnv("NOTIFICATION_EMAIL_READY", "true")
    vi.stubEnv("RESEND_API_KEY", "re_test")
    expect(notificationEmailReady()).toBe(true)
    vi.stubEnv("RESEND_API_KEY", "   ")
    expect(notificationEmailReady()).toBe(false)
    vi.stubEnv("RESEND_API_KEY", "re_test")
    vi.stubEnv("NOTIFICATION_EMAIL_READY", "false")
    expect(notificationEmailReady()).toBe(false)
  })

  it("uses the configured sender or the honest fallback", () => {
    expect(notificationEmailFrom()).toBe("SSL <onboarding@ssl.mtkcodex.site>")
    vi.stubEnv("RESEND_FROM_EMAIL", "X <no-reply@x.example>")
    expect(notificationEmailFrom()).toBe("X <no-reply@x.example>")
  })
})

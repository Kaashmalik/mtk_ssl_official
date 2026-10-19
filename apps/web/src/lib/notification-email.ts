import type { BrandPresentation } from "./brand-presentation"

/**
 * B161: THE notification email template. The only place notification copy and
 * PREM-02 branding meet for the email channel. Pure: no db, no env, no fetch —
 * callers resolve the brand snapshot (published only, allowlist-validated via
 * brandPresentation) and pass it in, so tests can pin every render.
 *
 * Emails are plain text exactly like the invitation pipeline (no HTML surface,
 * no injection opportunity; every interpolated value below is either
 * numbers/titles from the caller's own consented content or the sanitized
 * appName from the brand allowlist).
 */
export const NOTIFICATION_EMAIL_FROM_FALLBACK = "SSL <onboarding@ssl.mtkcodex.site>"

export type NotificationEmailInput = {
  leagueName: string
  title: string
  body: string
  /** Published, allowlist-validated brand snapshot; null renders the fallback. */
  brand: BrandPresentation | null
  /** Deep link into the in-app inbox, when the deployment provides one. */
  appUrl?: string | null
}

export type NotificationEmail = { subject: string; text: string }

export function notificationEmailReady(): boolean {
  return process.env.NOTIFICATION_EMAIL_READY === "true" &&
    Boolean(process.env.RESEND_API_KEY?.trim())
}

export function notificationEmailFrom(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || NOTIFICATION_EMAIL_FROM_FALLBACK
}

export function buildNotificationEmail(input: NotificationEmailInput): NotificationEmail {
  const appName = input.brand?.appName?.trim() || "SSL Cricket"
  const subject = `${appName}: ${input.title}`.slice(0, 200)
  const league = input.leagueName.trim() || "your league"
  const lines = [
    input.body.trim(),
    "",
    `— ${league}`,
    `Sent via ${appName}`,
  ]
  if (input.appUrl) {
    lines.push(`View in the app: ${input.appUrl}`)
  }
  lines.push(
    "",
    "You are receiving this because you enabled email notifications for this league.",
    "Turn them off anytime in Dashboard > Notifications.",
  )
  return { subject, text: lines.join("\n") }
}

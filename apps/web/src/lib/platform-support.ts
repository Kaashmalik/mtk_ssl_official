/**
 * ENH-02-04: privacy-conscious WhatsApp support constants and draft builder.
 *
 * The ONLY contact surface: `https://wa.me/923038111297`, displayed as
 * `+92 303 8111297`. The prefilled draft is built from an ALLOWLIST of saved
 * facts the user already sees on screen (league name, league URL, preferred
 * plan, application reference, the displayed status label) — never an email
 * or phone, never a token/OTP, never a reviewer note, never a payment
 * document. Every field is bounded; the URL is encoded exactly ONCE, here.
 */

export const PLATFORM_WHATSAPP_LINK_NUMBER = "923038111297"
export const PLATFORM_WHATSAPP_DISPLAY = "+92 303 8111297"
export const PLATFORM_WHATSAPP_BASE = "https://wa.me/"

export const SUPPORT_FIELD_MAX = 80
export const SUPPORT_MESSAGE_MAX = 600

export type PlatformSupportTopic = "setup" | "apply" | "status" | "recovery" | "billing"

export type PlatformSupportContext = {
  topic: PlatformSupportTopic
  /** Saved league name as the user sees it. */
  leagueName?: string | null
  /** Saved league URL slug. */
  leagueSlug?: string | null
  /** Preferred plan choice as stored on the saved form/application. */
  plan?: string | null
  /** The application's own reference (id), so support can find the record. */
  applicationReference?: string | null
  /** The status label exactly as DISPLAYED to the user — never raw review content. */
  statusLabel?: string | null
}

const TOPIC_SENTENCES: Record<PlatformSupportTopic, string> = {
  setup: "Hi! I need help creating my league on the platform.",
  apply: "Hi! I have a question about my league application.",
  status: "Hi! I would like an update on my league application.",
  recovery: "Hi! I need help getting back into my league workspace.",
  billing: "Hi! I have a billing question about my league subscription.",
}

/** Member-facing sentence for a support topic. */
export function describeSupportTopic(topic: PlatformSupportTopic): string {
  return TOPIC_SENTENCES[topic] ?? TOPIC_SENTENCES.recovery
}

/**
 * Binds one allowlisted field: collapsed whitespace, trimmed, hard-capped.
 * Anything that is not a plain finite string is treated as absent.
 */
function boundField(value: unknown): string | null {
  if (typeof value !== "string") return null
  const bounded = value.replace(/\s+/g, " ").trim().slice(0, SUPPORT_FIELD_MAX)
  return bounded.length > 0 ? bounded : null
}

/**
 * Builds the prefilled support draft. ONLY the allowlisted fields are read —
 * extra properties handed in by a buggy or hostile caller are ignored by
 * construction, and no sentence ever claims a message was (or will be) sent
 * automatically; the user sends it themselves in WhatsApp.
 */
export function buildPlatformSupportMessage(context: PlatformSupportContext): string {
  const parts: string[] = [describeSupportTopic(context.topic)]

  const leagueName = boundField(context.leagueName)
  if (leagueName) parts.push(`League: ${leagueName}`)

  const leagueSlug = boundField(context.leagueSlug)
  if (leagueSlug) parts.push(`League URL: ${leagueSlug}`)

  const plan = boundField(context.plan)
  if (plan) parts.push(`Preferred plan: ${plan}`)

  const reference = boundField(context.applicationReference)
  if (reference) parts.push(`Application reference: ${reference}`)

  const statusLabel = boundField(context.statusLabel)
  if (statusLabel) parts.push(`Status shown to me: ${statusLabel}`)

  const joinWith = (current: string, addition: string) =>
    current.length + 1 + addition.length <= SUPPORT_MESSAGE_MAX ? `${current}\n${addition}` : current

  return parts.reduce(joinWith)
}

/**
 * The one place WhatsApp URLs are built: a single encodeURIComponent pass
 * over the draft on the wa.me link. Callers never pre-encode.
 */
export function buildWhatsAppLink(message: string): string {
  return `${PLATFORM_WHATSAPP_BASE}${PLATFORM_WHATSAPP_LINK_NUMBER}?text=${encodeURIComponent(message)}`
}

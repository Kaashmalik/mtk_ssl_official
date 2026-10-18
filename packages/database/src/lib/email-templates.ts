/**
 * UX-03 (Batch 144): localized transactional email templates. The provider
 * (Resend) is already integrated; the gap this closes is that every email
 * the platform sends was English-only. The templates live HERE, in the pure
 * database package, so subject/body composition is testable without a
 * provider and cannot drift from the locale allowlist.
 *
 * Honesty rules:
 * - Locales beyond the en/bn/ar allowlist NEVER become a wrong language:
 *   they fall back to English (the platform default), same as page i18n.
 * - The bn/ar strings are MACHINE-DRAFTED and flagged for HUMAN REVIEW
 *   before any localized launch (standing UX-03 convention).
 * - Every user-controlled value (inviter name, league name) runs through a
 *   plain-line sanitation that strips line breaks and control characters:
 *   no header injection, no body spoofing through interpolated fields.
 * - Roles are the fixed invitation enum; an unknown role REFUSES rather
 *   than rendering something invented.
 */

export type EmailLocale = "en" | "bn" | "ar"

export const EMAIL_TEMPLATE_LOCALES: readonly EmailLocale[] = ["en", "bn", "ar"]

/** Accepts any string; only the allowlist changes the language, rest = en. */
export function normalizeEmailLocale(locale: string | null | undefined): EmailLocale {
  return locale === "bn" || locale === "ar" ? locale : "en"
}

/**
 * One safe line of plain text: line breaks and control characters cannot
 * appear in an interpolated email body, so a name or league name can never
 * forge a header or a fake paragraph.
 */
export function plainEmailLine(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\r\n\u0000-\u001f]+/g, " ").trim()
}

type RoleKey = "team_manager" | "captain" | "coach" | "scorer" | "player"

const ROLE_LABELS: Record<EmailLocale, Record<RoleKey, string>> = {
  en: {
    team_manager: "team manager",
    captain: "captain",
    coach: "coach",
    scorer: "scorer",
    player: "player",
  },
  // MACHINE-DRAFTED bn/ar translations - HUMAN REVIEW before localized launch.
  bn: {
    team_manager: "দল ম্যানেজার",
    captain: "অধিনায়ক",
    coach: "কোচ",
    scorer: "স্কোরার",
    player: "খেলোয়াড়",
  },
  ar: {
    team_manager: "مدير الفريق",
    captain: "قائد",
    coach: "مدرب",
    scorer: "مسجل النتائج",
    player: "لاعب",
  },
}

const INVITATION_TEMPLATES: Record<
  EmailLocale,
  {
    subject: (v: { leagueName: string }) => string
    body: (v: { inviterName: string; leagueName: string; roleLabel: string; link: string; expiresDays: number }) => string
  }
> = {
  en: {
    subject: (v) => `You have been invited to join ${v.leagueName} on SSL`,
    body: (v) =>
      `${v.inviterName} invited you to join "${v.leagueName}" as ${v.roleLabel}.\n\nAccept: ${v.link}\n\nExpires in ${v.expiresDays} days. Verify the invited email through your sign-in provider before accepting.`,
  },
  // MACHINE-DRAFTED bn translation - HUMAN REVIEW before localized launch.
  bn: {
    subject: (v) => `${v.leagueName}-এ SSL-এ যোগ দেওয়ার আমন্ত্রণ`,
    body: (v) =>
      `${v.inviterName} আপনাকে "${v.leagueName}"-এ ${v.roleLabel} হিসেবে যোগ দিতে আমন্ত্রণ জানিয়েছেন।\n\nগ্রহণ করুন: ${v.link}\n\n${v.expiresDays} দিনে মেয়াদ শেষ হবে। গ্রহণ করার আগে আপনার সাইন-ইন প্রোভাইডারের মাধ্যমে আমন্ত্রিত ইমেইল যাচাই করুন।`,
  },
  // MACHINE-DRAFTED ar translation - HUMAN REVIEW before localized launch.
  ar: {
    subject: (v) => `دعوة للانضمام إلى ${v.leagueName} على SSL`,
    body: (v) =>
      `${v.inviterName} يدعوكم للانضمام إلى "${v.leagueName}" بصفة ${v.roleLabel}.\n\nالقبول: ${v.link}\n\nتنتهي الصلاحية بعد ${v.expiresDays} أيام. تحققوا من البريد المدعو عبر مزود تسجيل الدخول قبل القبول.`,
  },
}

export interface InvitationEmailInput {
  locale: string | null | undefined
  inviterName: string
  leagueName: string
  role: string
  link: string
  expiresDays: number
}

export function renderInvitationEmail(input: InvitationEmailInput): { subject: string; text: string } {
  const locale = normalizeEmailLocale(input.locale)
  const role = input.role as RoleKey
  const roleLabel = ROLE_LABELS[locale][role]
  if (!roleLabel) throw new Error("Unknown invitation role")
  const vars = {
    inviterName: plainEmailLine(input.inviterName),
    leagueName: plainEmailLine(input.leagueName),
    roleLabel,
    link: plainEmailLine(input.link),
    expiresDays: Math.trunc(input.expiresDays),
  }
  return { subject: INVITATION_TEMPLATES[locale].subject(vars), text: INVITATION_TEMPLATES[locale].body(vars) }
}

const VERIFICATION_TEMPLATES: Record<
  EmailLocale,
  { subject: (v: { ttlMinutes: number }) => string; body: (v: { ttlMinutes: number }) => string }
> = {
  en: {
    subject: () => "Your SSL verification code",
    body: (v) => `Your SSL verification code is {code}. Valid for ${v.ttlMinutes} minutes. Do not share this code.`,
  },
  // MACHINE-DRAFTED bn translation - HUMAN REVIEW before localized launch.
  bn: {
    subject: () => "আপনার SSL ভেরিফিকেশন কোড",
    body: (v) => `আপনার SSL ভেরিফিকেশন কোড {code}। ${v.ttlMinutes} মিনিটের জন্য বৈধ। এই কোড কারও সাথে শেয়ার করবেন না।`,
  },
  // MACHINE-DRAFTED ar translation - HUMAN REVIEW before localized launch.
  ar: {
    subject: () => "رمز التحقق الخاص بك على SSL",
    body: (v) => `رمز التحقق الخاص بك على SSL هو {code}. صالح لمدة ${v.ttlMinutes} دقيقة. لا تشاركوا هذا الرمز.`,
  },
}

export function renderVerificationEmail(input: {
  locale: string | null | undefined
  code: string
  ttlMinutes: number
}): { subject: string; text: string } {
  const locale = normalizeEmailLocale(input.locale)
  const code = plainEmailLine(input.code)
  return {
    subject: VERIFICATION_TEMPLATES[locale].subject({ ttlMinutes: Math.trunc(input.ttlMinutes) }),
    text: VERIFICATION_TEMPLATES[locale].body({ ttlMinutes: Math.trunc(input.ttlMinutes) }).replace("{code}", code),
  }
}

/**
 * UX-03 (Batch 139): i18n policy. The platform is English-first with
 * Bengali (the home and diaspora audience) and Arabic (RTL audiences).
 * Locale resolution order (locales WITHOUT URL routing): an explicit
 * cookie wins, then Accept-Language negotiation, then English. The
 * negotiation reads ONLY language subtags it supports - a request for
 * "fr" never becomes a wrong language, it becomes honest English.
 */

export const LOCALES = ["en", "bn", "ar"] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "en"
export const LOCALE_COOKIE = "mtk-locale"

/** Languages written right-to-left; drives the html dir attribute. */
const RTL_LOCALES: ReadonlySet<string> = new Set(["ar"])

export function isLocale(value: string | undefined | null): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? "")
}

export function getLocaleDirection(locale: string): "rtl" | "ltr" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr"
}

/**
 * Picks the first supported subtag from an Accept-Language header,
 * honoring quality values (q=). Multiple q values on one subtag or
 * malformed entries degrade to q=1 (the header's own default).
 */
export function negotiateLocale(acceptLanguage: string | undefined | null): Locale | null {
  if (!acceptLanguage) return null
  const parsed: Array<{ tag: string; q: number }> = []
  for (const part of acceptLanguage.split(",")) {
    const [tagRaw, ...params] = part.split(";")
    const tag = tagRaw.trim().toLowerCase()
    if (!tag) continue
    let q = 1
    for (const p of params) {
      const [key, value] = p.split("=")
      if (key?.trim() === "q") {
        const parsedQ = Number(value)
        if (Number.isFinite(parsedQ) && parsedQ >= 0) q = parsedQ
      }
    }
    // A wildcard cannot pin a language; exact subtags only.
    if (tag !== "*") parsed.push({ tag, q })
  }
  parsed.sort((a, b) => b.q - a.q)
  for (const { tag } of parsed) {
    const exact = tag.split("-")[0]
    if (isLocale(exact)) return exact
  }
  return null
}

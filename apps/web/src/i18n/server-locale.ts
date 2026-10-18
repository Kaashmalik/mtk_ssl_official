import { cookies, headers } from "next/headers"
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "./config"

/**
 * UX-03 (Batch 144): the request locale for SERVER-SIDE composition that is
 * not a page render - transactional emails. Same resolution order as the
 * page i18n (explicit cookie, then Accept-Language, then English), but
 * fail-soft: email composition must never break because no request scope
 * exists (a background path or a non-RSC caller). Outside a request scope
 * the honest result is the platform default (English), never a guessed
 * language.
 */
export async function resolveRequestLocale(): Promise<Locale> {
  try {
    const store = await cookies()
    const cookieLocale = store.get(LOCALE_COOKIE)?.value
    if (isLocale(cookieLocale)) return cookieLocale
    const headerLocale = negotiateLocale((await headers()).get("accept-language"))
    if (headerLocale) return headerLocale
    return DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

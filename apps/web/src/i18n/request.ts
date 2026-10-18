import { getRequestConfig } from "next-intl/server"
import { resolveRequestLocale } from "./server-locale"

/**
 * UX-03 (Batch 139): the request locale WITHOUT URL routing - an explicit
 * cookie wins, then the browser's Accept-Language negotiation, then
 * English. Batch 144 moves the resolution itself into server-locale.ts so
 * transactional emails compose in the SAME locale the user chose (the
 * fail-soft English fallback there covers out-of-scope callers; a page
 * render always has a request scope). Messages load per resolved locale; a
 * locale that fails to load would be Corruption, so the config only ever
 * names supported locales and each messages file must exist (pinned by
 * i18n tests).
 */
export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale()

  const messages = (await import(`../../messages/${locale}.json`)).default
  return { locale, messages }
})

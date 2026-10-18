import { cookies, headers } from "next/headers"
import { getRequestConfig } from "next-intl/server"
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from "./config"

/**
 * UX-03 (Batch 139): the request locale WITHOUT URL routing - an explicit
 * cookie wins, then the browser's Accept-Language negotiation, then
 * English. Messages load per resolved locale; a locale that fails to
 * load would be Corruption, so the config only ever names supported
 * locales and each messages file must exist (pinned by i18n tests).
 */
export default getRequestConfig(async () => {
  const store = await cookies()
  const cookieLocale = store.get(LOCALE_COOKIE)?.value

  let locale = DEFAULT_LOCALE
  if (isLocale(cookieLocale)) {
    locale = cookieLocale
  } else {
    const headerLocale = negotiateLocale((await headers()).get("accept-language"))
    if (headerLocale) locale = headerLocale
  }

  const messages = (await import(`../../messages/${locale}.json`)).default
  return { locale, messages }
})

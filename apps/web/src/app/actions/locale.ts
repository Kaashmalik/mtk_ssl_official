"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { LOCALE_COOKIE, isLocale, type Locale } from "@/i18n/config"
import { saveMyLocalePreference } from "@/lib/account-locale"

/**
 * UX-03 (Batch 139): records the session's language preference in the
 * mtk-locale cookie. Only the three supported locales are settable - an
 * unsupported value refuses rather than becoming a corrupted preference.
 * The cookie is first-party, a year long, and read by i18n/request.ts.
 * Root-layout revalidation makes the new locale render immediately.
 */
export async function setLocalePreference(locale: string): Promise<{ success: true; locale: Locale }> {
  if (!isLocale(locale)) throw new Error("Unsupported language")
  await saveMyLocalePreference(locale)
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false, // read direction is server-side; keep it simple, no secrets inside
  })
  revalidatePath("/", "layout")
  return { success: true, locale }
}

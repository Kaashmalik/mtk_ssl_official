"use client"

import { useEffect, useState, useTransition } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { setLocalePreference } from "@/app/actions/locale"
import { LOCALES, LOCALE_COOKIE } from "@/i18n/config"

/** Native endonyms - the switcher labels read in the TARGET language, so a
 * user who cannot read the current locale can still find their own. */
const LOCALE_LABELS: Record<(typeof LOCALES)[number], string> = {
  en: "English",
  bn: "বাংলা",
  ar: "العربية",
}

/**
 * UX-03 (Batch 139): the language switcher. Sets the mtk-locale cookie
 * through the server action (which revalidates the root layout, so server
 * components re-resolve the locale immediately). The CURRENT preference is
 * read after hydration only - document.cookie does not exist during SSR,
 * so nothing highlights until the client knows (an honest unhighlighted
 * beat rather than a wrong one).
 */
export function LocaleSwitcher() {
  const [preferred, setPreferred] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    setPreferred(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
        ?.split("=")[1] ?? null,
    )
  }, [])

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Language">
      {LOCALES.map((locale) => (
        <Button
          key={locale}
          type="button"
          size="sm"
          variant={preferred === locale ? "default" : "ghost"}
          disabled={pending}
          className="h-8 px-2 text-xs"
          lang={locale}
          onClick={() =>
            startTransition(async () => {
              await setLocalePreference(locale)
              setPreferred(locale)
            })
          }
        >
          {LOCALE_LABELS[locale]}
        </Button>
      ))}
    </div>
  )
}

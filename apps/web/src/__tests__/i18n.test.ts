import { describe, expect, it } from "vitest"
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  getLocaleDirection,
  isLocale,
  negotiateLocale,
} from "../i18n/config"
import en from "../../messages/en.json"
import bn from "../../messages/bn.json"
import ar from "../../messages/ar.json"

const MESSAGES = { en, bn, ar } as const

/** Deep key parity: every leaf the English dictionary has must exist in every
 * other locale - a missing key would render raw message ids to fans. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafPaths(v, prefix ? `${prefix}.${k}` : k),
  )
}

describe("UX-03 (Batch 139): i18n policy and dictionaries", () => {
  it("supports exactly en, bn, ar with en as the honest fallback", () => {
    expect(LOCALES).toEqual(["en", "bn", "ar"])
    expect(DEFAULT_LOCALE).toBe("en")
    expect(LOCALE_COOKIE).toBe("mtk-locale")
  })

  it("rejects unknown locales and accepts the supported set", () => {
    expect(isLocale("fr")).toBe(false)
    expect(isLocale("")).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true)
  })

  it("maps Arabic to rtl and everything else to ltr", () => {
    expect(getLocaleDirection("ar")).toBe("rtl")
    expect(getLocaleDirection("en")).toBe("ltr")
    expect(getLocaleDirection("bn")).toBe("ltr")
  })

  it("negotiates from Accept-Language honoring quality values", () => {
    expect(negotiateLocale("bn-BD,bn;q=0.9,en;q=0.8")).toBe("bn")
    expect(negotiateLocale("ar")).toBe("ar")
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en")
    expect(negotiateLocale("fr-FR,fr;q=0.9,ar;q=0.5")).toBe("ar")
    // Unsupported languages never become a WRONG language.
    expect(negotiateLocale("fr-FR,de;q=0.8")).toBeNull()
    expect(negotiateLocale("*")).toBeNull()
    expect(negotiateLocale(null)).toBeNull()
    expect(negotiateLocale("")).toBeNull()
  })

  it("every locale's dictionary carries the exact same keys as English", () => {
    const enLeaves = leafPaths(en).sort()
    expect(enLeaves.length).toBeGreaterThan(10)
    for (const locale of ["bn", "ar"] as const) {
      expect(leafPaths(MESSAGES[locale]).sort()).toEqual(enLeaves)
    }
  })

  it("English values are non-empty strings (no blank facets)", () => {
    for (const path of leafPaths(en)) {
      const value = path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], en)
      expect(typeof value === "string" && value.length > 0, path).toBe(true)
    }
  })
})

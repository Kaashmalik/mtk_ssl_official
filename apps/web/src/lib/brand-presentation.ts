/**
 * The only branding fields allowed to cross the server/client boundary.
 *
 * Batch 176 (PREM-02): logoUrl, hideSslBranding and customCss join the
 * whitelist so the published snapshot reaches the dashboard chrome, not
 * just colors/fonts/name. Sanitization is trust-boundary discipline:
 *   - logoUrl: HTTPS-only URL (same rule as faviconUrl);
 *   - hideSslBranding: boolean only (it gates the platform credit);
 *   - customCss: length-bounded and structure-neutralized, NOT "sanitized
 *     into safety" — CSS is the tenant's own premium surface (plan-gated
 *     write path); the neutralization only stops the string breaking out
 *     of its <style> element.
 */
export type BrandPresentation = {
  primaryColor?: string; secondaryColor?: string; accentColor?: string;
  fontFamily?: string; faviconUrl?: string; appName?: string;
  logoUrl?: string; hideSslBranding?: boolean; customCss?: string;
}

const CUSTOM_CSS_MAX_LENGTH = 20_000

function customCss(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  // Control characters (except tab/newline/carriage return) have no honest
  // business in a stylesheet; `</style` (any case) would close the element
  // the CSS is injected into - split the tag instead of deleting words.
  const bounded = value.slice(0, CUSTOM_CSS_MAX_LENGTH)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/<\/style/gi, "<\\/style")
  return bounded.trim().length > 0 ? bounded : undefined
}

function color(value: unknown): string | undefined {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : undefined
}

const ALLOWED_FONTS = new Set(["Inter", "Arial", "Georgia", "system-ui", "sans-serif", "serif"])

function appName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const cleaned = value.replace(/[\u0000-\u001f<>&"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 128)
  return cleaned || undefined
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function brandPresentation(row: unknown): BrandPresentation | null {
  if (!row || typeof row !== "object") return null
  const source = row as Record<string, unknown>
  return {
    primaryColor: color(source.primaryColor), secondaryColor: color(source.secondaryColor),
    accentColor: color(source.accentColor), faviconUrl: safeHttpsUrl(source.faviconUrl),
    fontFamily: typeof source.fontFamily === "string" && ALLOWED_FONTS.has(source.fontFamily) ? source.fontFamily : undefined,
    appName: appName(source.appName),
    logoUrl: safeHttpsUrl(source.logoUrl),
    hideSslBranding: source.hideSslBranding === true,
    customCss: customCss(source.customCss),
  }
}

function contrastText(hex: string): string {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff"
}

export function brandVariables(branding: BrandPresentation | null): Record<string, string> {
  const vars: Record<string, string> = {}
  if (!branding) return vars
  for (const [field, token] of [["primaryColor", "primary"], ["secondaryColor", "secondary"], ["accentColor", "accent"]] as const) {
    const value = color(branding[field])
    if (value) { vars[`--${token}`] = value; vars[`--${token}-foreground`] = contrastText(value) }
  }
  if (branding.fontFamily) vars["--font-sans"] = branding.fontFamily
  return vars
}

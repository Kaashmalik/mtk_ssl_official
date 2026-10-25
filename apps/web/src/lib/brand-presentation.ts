/** The only branding fields allowed to cross the server/client boundary. */
export type BrandPresentation = {
  primaryColor?: string; secondaryColor?: string; accentColor?: string;
  fontFamily?: string; faviconUrl?: string; appName?: string;
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

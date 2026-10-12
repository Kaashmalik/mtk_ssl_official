import { z } from "zod"

export const MAX_LOGO_BYTES = 128 * 1024
export const MAX_LOGO_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 64
export const moneySchema = z.number().finite().min(0).max(99999999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
    "Use at most two decimal places")
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return value.slice(0, 4) !== "0000" && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, "Choose a valid calendar date")

export const logoSchema = z.string().max(MAX_LOGO_LENGTH).refine((value) => {
  if (value.length > MAX_LOGO_LENGTH) return false
  if (value === "") return true
  if (value.startsWith("data:")) {
    if (!/^data:image\/(png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
    const encoded = value.split(",")[1]
    const bytes = encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0)
    return bytes > 0 && bytes <= MAX_LOGO_BYTES
  }
  try {
    const url = new URL(value)
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password
  } catch { return false }
}, "Use a PNG, JPEG or WebP image (up to 128 KB), or an HTTPS image URL")
export const primaryColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color")
export const matchTypeSchema = z.enum(["t20", "odi", "tape_ball", "custom"])

export const tournamentConfigurationSchema = z.object({
  version: z.literal(1),
  matchType: matchTypeSchema,
  overs: z.number().int().min(1).max(50),
  location: z.string().trim().min(1).max(200),
  // These are bracket slots, NOT registered team UUIDs.
  seedOrder: z.array(z.number().int().min(1).max(128)).min(2).max(128),
  branding: z.object({ logo: logoSchema.optional(), primaryColor: primaryColorSchema.optional() }).strict(),
}).strict().superRefine((value, ctx) => {
  if ((value.matchType === "t20" && value.overs !== 20) || (value.matchType === "odi" && value.overs !== 50)) {
    ctx.addIssue({ code: "custom", path: ["overs"], message: "Overs must match the selected match type" })
  }
  if (new Set(value.seedOrder).size !== value.seedOrder.length || value.seedOrder.some((slot) => slot > value.seedOrder.length)) {
    ctx.addIssue({ code: "custom", path: ["seedOrder"], message: "Seed order must contain every bracket slot exactly once" })
  }
})
export type TournamentConfiguration = z.infer<typeof tournamentConfigurationSchema>

export const prizePoolSchema = z.object({
  version: z.literal(1),
  total: z.string().regex(/^(0|[1-9]\d{0,7})\.\d{2}$/),
}).strict()

export function readTournamentConfiguration(rules: unknown): TournamentConfiguration | null {
  if (!rules || typeof rules !== "object" || Array.isArray(rules) || !("wizard" in rules)) return null
  const result = tournamentConfigurationSchema.safeParse(rules.wizard)
  return result.success ? result.data : null
}

export function readPrizePool(value: unknown): string | null {
  const result = prizePoolSchema.safeParse(value)
  return result.success ? result.data.total : null
}

export function decimalMoney(value: number): string {
  return moneySchema.parse(value).toFixed(2)
}

export function resizeSeedOrder(order: number[], maxTeams: number): number[] {
  z.number().int().min(2).max(128).parse(maxTeams)
  const available = new Set(Array.from({ length: maxTeams }, (_, i) => i + 1))
  const retained = order.filter((slot) => available.delete(slot))
  return [...retained, ...available]
}

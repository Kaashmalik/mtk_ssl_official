import { z } from "zod"
import { calendarDateSchema, logoSchema, matchTypeSchema, moneySchema, primaryColorSchema,
  readPrizePool, readTournamentConfiguration, tournamentConfigurationSchema } from "@mtk/database/lib/tournament-configuration"
import type { Tournament } from "@mtk/database"
import type { CreateTournamentInput } from "@/app/actions/tournaments"

// Validate the match step independently, even when later required fields are blank.
const matchChoiceSchema = z.object({
  matchType: matchTypeSchema,
  customOvers: z.number().int().min(1).max(50).optional(),
}).superRefine((value, ctx) => {
  if ((value.matchType === "custom" || value.matchType === "tape_ball") && value.customOvers === undefined) {
    ctx.addIssue({ code: "custom", path: ["customOvers"], message: "Choose the number of overs" })
  }
})

export const tournamentWizardSchema = z.object({
  format: z.enum(["knockout", "league", "hybrid"]),
  name: z.string().trim().min(3).max(100),
  description: z.string().max(500).optional(),
  startDate: z.union([calendarDateSchema, z.literal("")]),
  endDate: z.union([calendarDateSchema, z.literal("")]),
  location: z.string().trim().min(1).max(200),
  maxTeams: z.number().int().min(2).max(64),
  registrationFee: moneySchema.optional(),
  prizePool: moneySchema.optional(),
  teamSeeding: z.array(z.string().regex(/^team-([1-9]|[1-5]\d|6[0-4])$/)).max(64).optional(),
  logo: logoSchema.optional(),
  primaryColor: primaryColorSchema.optional(),
}).and(matchChoiceSchema).superRefine((value, ctx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the start date" })
  }
  const seeds = value.teamSeeding ?? []
  if (seeds.length && (seeds.length !== value.maxTeams || new Set(seeds).size !== seeds.length ||
      seeds.some((id) => Number(id.slice(5)) > value.maxTeams))) {
    ctx.addIssue({ code: "custom", path: ["teamSeeding"], message: "Include every bracket slot exactly once" })
  }
})

export type TournamentFormData = z.infer<typeof tournamentWizardSchema>

export const TOURNAMENT_STEP_FIELDS = [
  ["format"], ["matchType", "customOvers"],
  ["name", "description", "startDate", "endDate", "location"],
  ["maxTeams", "registrationFee", "prizePool"], ["startDate", "endDate"],
  ["teamSeeding"], ["logo", "primaryColor"],
] as const satisfies ReadonlyArray<ReadonlyArray<keyof TournamentFormData>>

export function tournamentWizardToInput(input: TournamentFormData): CreateTournamentInput {
  const data = tournamentWizardSchema.parse(input)
  return {
    name: data.name, description: data.description || null, format: data.format,
    startDate: data.startDate || null, endDate: data.endDate || null, maxTeams: data.maxTeams,
    registrationFee: data.registrationFee ?? 0, prizeAmount: data.prizePool ?? 0,
    status: "draft", registrationOpen: false,
    configuration: tournamentConfigurationSchema.parse({
      version: 1, matchType: data.matchType,
      overs: data.matchType === "t20" ? 20 : data.matchType === "odi" ? 50 : data.customOvers,
      location: data.location,
      seedOrder: data.teamSeeding?.length ? data.teamSeeding.map((id) => Number(id.slice(5)))
        : Array.from({ length: data.maxTeams }, (_, i) => i + 1),
      branding: { logo: data.logo || undefined, primaryColor: data.primaryColor },
    }),
  }
}

/** Copy reusable settings, never tournament identity, dates, or registration state. */
export function tournamentToWizardDefaults(tournament: Pick<Tournament,
  "format" | "description" | "maxTeams" | "rules" | "entryFee" | "prizePool">): Partial<TournamentFormData> {
  const configuration = readTournamentConfiguration(tournament.rules)
  const maxTeams = Math.min(64, Math.max(2, tournament.maxTeams ?? 8))
  const fee = moneySchema.safeParse(Number(tournament.entryFee ?? "0"))
  const prize = moneySchema.safeParse(Number(readPrizePool(tournament.prizePool) ?? "0"))
  return {
    format: tournament.format === "round_robin" ? "league" : tournament.format,
    description: tournament.description?.slice(0, 500) ?? "", maxTeams,
    registrationFee: fee.success ? fee.data : 0, prizePool: prize.success ? prize.data : 0,
    matchType: configuration?.matchType,
    customOvers: configuration && ["custom", "tape_ball"].includes(configuration.matchType) ? configuration.overs : undefined,
    location: configuration?.location ?? "", logo: configuration?.branding.logo ?? "",
    primaryColor: configuration?.branding.primaryColor ?? "#10b981",
    teamSeeding: configuration && configuration.seedOrder.length === maxTeams
      ? configuration.seedOrder.map((slot) => `team-${slot}`) : [],
  }
}

/** Keep valid reordered slots when capacity changes, then add missing slots. */
export function reconcileSlotOrder(order: string[], maxTeams: number): string[] {
  if (!Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams > 64) return []
  const available = new Set(Array.from({ length: maxTeams }, (_, i) => `team-${i + 1}`))
  const result: string[] = []
  for (const id of order) {
    if (available.delete(id)) result.push(id)
  }
  return [...result, ...available]
}

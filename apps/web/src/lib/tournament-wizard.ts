import { z } from "zod"

export const tournamentWizardSchema = z.object({
  format: z.enum(["knockout", "league", "hybrid"]),
  matchType: z.enum(["t20", "odi", "tape_ball", "custom"]),
  customOvers: z.number().min(1).max(50).optional(),
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string().min(1),
  maxTeams: z.number().min(2).max(64),
  registrationFee: z.number().min(0).optional(),
  prizePool: z.number().min(0).optional(),
  teamSeeding: z.array(z.string()).optional(),
  logo: z.string().optional(),
  primaryColor: z.string().optional(),
})

export type TournamentFormData = z.infer<typeof tournamentWizardSchema>

/** Fields owned by each step; final submission still validates the entire form. */
export const TOURNAMENT_STEP_FIELDS = [
  ["format"],
  ["matchType", "customOvers"],
  ["name", "description", "startDate", "endDate", "location"],
  ["maxTeams", "registrationFee", "prizePool"],
  ["startDate", "endDate"],
  ["teamSeeding"],
  ["logo", "primaryColor"],
] as const satisfies ReadonlyArray<ReadonlyArray<keyof TournamentFormData>>

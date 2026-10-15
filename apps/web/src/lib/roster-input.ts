import { z } from "zod"

const imageUrl = z.string().max(2048).url().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password }
  catch { return false }
}, "Use an HTTPS image URL without credentials")
const birthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= "1000-01-01" && value <= new Date().toISOString().slice(0, 10)
}, "Invalid date of birth")

export const teamInput = z.object({
  name: z.string().trim().min(2).max(100), tenantId: z.string().uuid().optional(),
  shortName: z.string().trim().min(2).max(10).nullish(),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().max(2000).nullish(), city: z.string().trim().max(100).nullish(),
  logoUrl: imageUrl.nullish(), bannerUrl: imageUrl.nullish(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  jerseyColor: z.string().max(50).nullish(), homeGround: z.string().max(200).nullish(),
  foundedYear: z.number().int().min(1800).max(2100).nullish(),
  maxSquadSize: z.number().int().min(5).max(30).optional(), tournamentId: z.string().uuid().nullish(),
}).strict()
export const teamPatch = teamInput.omit({ tenantId: true }).partial().strict()
export const playerInput = z.object({
  name: z.string().trim().min(2).max(100), tenantId: z.string().uuid().optional(), teamId: z.string().uuid().nullish(),
  role: z.enum(["batsman", "bowler", "all_rounder", "wicket_keeper", "wicket_keeper_batsman"]).nullish(),
  battingStyle: z.enum(["right", "left"]).nullish(),
  bowlingStyle: z.enum(["right_arm_fast", "right_arm_medium", "right_arm_spin", "left_arm_fast", "left_arm_medium", "left_arm_spin"]).nullish(),
  jerseyNumber: z.number().int().min(0).max(999).nullish(), photoUrl: imageUrl.nullish(), dateOfBirth: birthDate.nullish(),
  phone: z.string().max(20).nullish(), email: z.string().max(254).email().nullish(),
  nationality: z.string().max(100).nullish(), city: z.string().max(100).nullish(),
  heightCm: z.number().int().min(100).max(250).nullish(), weightKg: z.number().int().min(30).max(200).nullish(),
  biography: z.string().max(2000).nullish(), status: z.enum(["active", "injured", "retired", "suspended", "inactive"]).optional(),
}).strict()
export const playerPatch = playerInput.omit({ tenantId: true }).partial().strict()

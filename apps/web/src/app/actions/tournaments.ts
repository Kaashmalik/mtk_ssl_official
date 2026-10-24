"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { tournamentRepo } from "@mtk/database"
import { withTenantContext, type Tournament } from "@mtk/database"
import { z } from "zod"
import { requirePermissionServer, resolveActiveTenantId } from "@/lib/rbac-server"
import type { Permission } from "@/lib/rbac"
import { calendarDateSchema, decimalMoney, moneySchema, readTournamentConfiguration, resizeSeedOrder, tournamentConfigurationSchema } from "@mtk/database/lib/tournament-configuration"
import { archiveTournament, setTournamentRegistration } from "@/lib/tournament-lifecycle"
import { writeQualificationRule } from "@mtk/database/lib/qualification-policy"
import { generateTournamentFixtures } from "@/lib/fixture-generation"
import { advanceKnockoutTournament } from "@/lib/tournament-advancement"
import { createTournamentRecord, updateTournamentRecord } from "@/lib/tournament-writes"
import { setCompetitionLock as setCompetitionLockWriter } from "@/lib/competition-locks"

const createTournamentSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(100).optional(),
  description: z.string().max(5000).optional().nullable(),
  format: z.enum(["knockout", "league", "hybrid", "round_robin"]),
  startDate: calendarDateSchema.optional().nullable(),
  endDate: calendarDateSchema.optional().nullable(),
  registrationDeadline: calendarDateSchema.optional().nullable(),
  registrationOpen: z.boolean().default(false),
  maxTeams: z.number().int().min(2).max(128).optional().nullable(),
  status: z.enum(["draft", "registration", "live", "completed", "cancelled"]).default("draft"),
  registrationFee: moneySchema.optional(),
  prizeAmount: moneySchema.optional(),
  configuration: tournamentConfigurationSchema.optional(),
  // COMP-03 (Batch 136): creation-recovery idempotency key from the
  // client wizard's durable draft. Strict schema: unknown junk still
  // refuses, and a malformed key refuses rather than silently losing the
  // recovery guarantee.
  requestKey: z.string().uuid().optional().nullable(),
  // Batch 146: the league ORGANIZER's qualification rule — the only policy
  // that exists. Optional/nullable; "none" is a valid, explicit choice.
  // Exact shapes, bounded sizes (the schema caps teams at 128).
  qualificationRule: z.union([
    z.object({ kind: z.literal("top_n"), spots: z.number().int().min(1).max(128) }).strict(),
    z.object({ kind: z.literal("top_per_group"), perGroup: z.number().int().min(1).max(128) }).strict(),
  ]).optional().nullable(),
}).strict()

// Configuration is persisted at creation. Ordinary edits must not replace rules.
const updateTournamentSchema = createTournamentSchema.omit({ configuration: true }).partial()

function validateRelations(input: { startDate?: string | null; endDate?: string | null;
  maxTeams?: number | null; configuration?: z.infer<typeof tournamentConfigurationSchema> }) {
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new Error("End date must be on or after the start date")
  }
  if (input.configuration && input.configuration.seedOrder.length !== input.maxTeams) {
    throw new Error("Seed order must match the maximum number of teams")
  }
}

type PersistenceInput = z.infer<typeof updateTournamentSchema> & {
  configuration?: z.infer<typeof tournamentConfigurationSchema>
}

function persistenceValues<T extends PersistenceInput>(input: T) {
  // Batch 146: qualificationRule is NOT a column — it rides the tournament's
  // own rules jsonb (same namespacing as the wizard configuration) and is
  // merged by the update writer, preserving every other rules key.
  const { registrationFee, prizeAmount, configuration, qualificationRule: _qualificationRule, ...base } = input as PersistenceInput
  return {
    ...base,
    ...(registrationFee !== undefined ? { entryFee: decimalMoney(registrationFee) } : {}),
    ...(prizeAmount !== undefined ? { prizePool: { version: 1 as const, total: decimalMoney(prizeAmount) } } : {}),
    ...(configuration !== undefined ? { rules: { wizard: configuration } } : {}),
  } as Omit<T, "registrationFee" | "prizeAmount" | "configuration"> & {
    entryFee?: string
    prizePool?: { version: 1; total: string }
    rules?: { wizard: z.infer<typeof tournamentConfigurationSchema> }
  }
}

export type CreateTournamentInput = z.input<typeof createTournamentSchema>
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/** Resolve once, then authorize and query the same tenant. */
async function requireTournamentContext(permission: Permission) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found. Create a league first.")

  await requirePermissionServer(permission, tenantId)
  return { userId, tenantId }
}

/**
 * Create a new tournament.
 *
 * The exact active league is resolved from Clerk auth; `createTournamentRecord`
 * then locks account -> league -> membership, enforces a per-league unique slug
 * and writes the insert plus an audit in one transaction.
 */
export async function createTournament(input: CreateTournamentInput) {
  const { userId, tenantId } = await requireTournamentContext("tournament:create")

  const validated = createTournamentSchema.parse(input)
  validateRelations(validated)
  const slug = validated.slug || generateSlug(validated.name)

  // Clerk's string ID is not the UUID referenced by tournaments.created_by; the
  // writer resolves the active account under its lock. The recovery key rides
  // along so a retried submit (same durable draft) replays, never duplicates.
  // Batch 147 (reviewer Major): the create path now merges the organizer's
  // qualificationRule the same way the update writer does — the schema
  // validates it, so accepting it and silently dropping it was a lie.
  const values = { ...persistenceValues(validated), slug }
  if (validated.qualificationRule !== undefined) {
    const baseRules = values.rules ?? {}
    // The persistence type models only the wizard namespace; the policy's
    // merge guarantees the qualification namespace rides beside it.
    ;(values as { rules?: unknown }).rules = writeQualificationRule(baseRules, validated.qualificationRule)
  }
  const tournament = await createTournamentRecord(userId, tenantId, values, validated.requestKey ?? null)

  revalidatePath("/dashboard/tournaments")
  revalidatePath("/dashboard")
  return { success: true, tournament }
}

/**
 * Update a tournament.
 *
 * The writer locks the exact-league row, rechecks the current owner and writes the
 * update plus an audit in one transaction; a renamed slug keeps per-league
 * uniqueness.
 */
export async function updateTournament(id: string, input: UpdateTournamentInput) {
  const { userId, tenantId } = await requireTournamentContext("tournament:update")

  const validated = updateTournamentSchema.parse(input)

  const tournament = await updateTournamentRecord(userId, tenantId, id, (existing) => {
    const cleanData = Object.fromEntries(Object.entries(persistenceValues(validated)).filter(([, v]) => v !== undefined)) as Record<string, unknown>
    if (cleanData.name && !cleanData.slug) cleanData.slug = generateSlug(cleanData.name as string)

    validateRelations({
      startDate: validated.startDate === undefined ? existing.startDate : validated.startDate,
      endDate: validated.endDate === undefined ? existing.endDate : validated.endDate,
    })
    const configuration = readTournamentConfiguration(existing.rules)
    if (configuration && existing.rules && typeof existing.rules === "object" && !Array.isArray(existing.rules) && validated.maxTeams !== undefined) {
      if (validated.maxTeams === null) throw new Error("A saved bracket setup requires a maximum team count")
      cleanData.rules = { ...existing.rules, wizard: {
        ...configuration, seedOrder: resizeSeedOrder(configuration.seedOrder, validated.maxTeams),
      } }
    }
    // Batch 146: the organizer's qualification rule rides the rules jsonb,
    // merged so every other namespaced key (the wizard config above all)
    // survives; `null` clears it — "none" is an explicit organizer choice.
    if (validated.qualificationRule !== undefined) {
      const baseRules = cleanData.rules ??
        (typeof existing.rules === "object" && existing.rules !== null && !Array.isArray(existing.rules)
          ? existing.rules
          : {})
      cleanData.rules = writeQualificationRule(baseRules, validated.qualificationRule)
    }
    return cleanData
  })

  revalidatePath("/dashboard/tournaments")
  revalidatePath(`/dashboard/tournaments/${id}`)
  // PUB-06 withdrawal/cache invalidation: the public page renders name,
  // description, status and dates - an update (including unpublish) must
  // drop the cached public route too, not just the dashboard copy.
  revalidatePath(`/tournaments/${id}`)
  return { success: true, tournament }
}

/**
 * Delete a tournament.
 */
export async function deleteTournament(id: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:delete")
  z.string().uuid().parse(id)

  // Compatibility action name. Never hard-delete: cancelling the tournament
  // preserves its registrations, team links and match links.
  await archiveTournament(userId, tenantId, id)

  revalidatePath("/dashboard/tournaments")
  revalidatePath(`/dashboard/tournaments/${id}`)
  revalidatePath("/dashboard")
  // Archival is the withdrawal path: the public page must stop serving the
  // cached tournament immediately (publication gate 404s on next render).
  revalidatePath(`/tournaments/${id}`)
  return { success: true }
}

/**
 * Get a single tournament.
 */
export async function getTournament(id: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:read")

  return withTenantContext({ userId, tenantId }, () =>
    tournamentRepo.findById<Tournament>(id)
  )
}

/** Lightweight copy picker: never serialize all tournament logos/rules at once. */
export async function getTournamentCopyOptions() {
  const { userId, tenantId } = await requireTournamentContext("tournament:read")
  const result = await withTenantContext({ userId, tenantId }, () => tournamentRepo.findFiltered({
    page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc",
  }))
  return result.data.map(({ id, name, format, maxTeams }) => ({ id, name, format, maxTeams }))
}

/**
 * Open tournament registration.
 */
export async function openRegistration(tournamentId: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:manage_registrations")
  z.string().uuid().parse(tournamentId)

  const tournament = await setTournamentRegistration(userId, tenantId, tournamentId, true)

  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  revalidatePath("/dashboard/tournaments")
  return { success: true, tournament }
}

/**
 * Close tournament registration.
 */
export async function closeRegistration(tournamentId: string) {
  const { userId, tenantId } = await requireTournamentContext("tournament:manage_registrations")
  z.string().uuid().parse(tournamentId)

  const tournament = await setTournamentRegistration(userId, tenantId, tournamentId, false)

  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  revalidatePath("/dashboard/tournaments")
  return { success: true, tournament }
}

/**
 * Generate the tournament's fixtures from its approved registrations. This
 * starts the competition: the tournament becomes live and registration
 * closes. Creating matches requires the match:create permission.
 */
export async function generateFixtures(tournamentId: string) {
  const { userId, tenantId } = await requireTournamentContext("match:create")
  z.string().uuid().parse(tournamentId)

  const result = await generateTournamentFixtures(userId, tenantId, tournamentId)

  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  revalidatePath("/dashboard/matches")
  // Fixtures + the live status are public content (PUB-06 cache
  // invalidation): the public tournament page must re-render.
  revalidatePath(`/tournaments/${tournamentId}`)
  return { success: true, ...result }
}

/**
 * Advance a knockout tournament to its next bracket stage from decided
 * results; once the final is decided the tournament completes. Creating
 * matches requires the match:create permission.
 */
export async function advanceTournament(tournamentId: string) {
  const { userId, tenantId } = await requireTournamentContext("match:create")
  z.string().uuid().parse(tournamentId)

  const result = await advanceKnockoutTournament(userId, tenantId, tournamentId)

  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  revalidatePath("/dashboard/matches")
  // Bracket, results and a freshly persisted champion are public content.
  revalidatePath(`/tournaments/${tournamentId}`)
  return { success: true, ...result }
}

/**
 * COMP-07: place or lift the competition lock that freezes the
 * competition's fixture edits. `settings:manage` authorizes at this
 * boundary; the writer re-verifies the acting league owner under its own
 * locks (tenant is re-derived from the tournament row, never trusted from
 * the caller) and audits COMPETITION_LOCK / COMPETITION_UNLOCK.
 */
export async function setCompetitionLock(tournamentId: string, lock: boolean) {
  await requireTournamentContext("settings:manage")
  z.string().uuid().parse(tournamentId)
  z.boolean().parse(lock)

  const result = await setCompetitionLockWriter(tournamentId, lock)

  revalidatePath(`/dashboard/tournaments/${tournamentId}`)
  revalidatePath("/dashboard/matches")
  return { success: true, ...result }
}

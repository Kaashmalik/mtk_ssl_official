"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { withAuth } from "./action-guard"
import { resolveActiveTenantId, requirePermissionServer } from "@/lib/rbac-server"
import type { Permission } from "@/lib/rbac"
import {
  requireRegistrationReadContext, readRegistrations, readActorRegistrations, readRegistrationTournamentOptions,
  readRegistrationSquadOptions,
} from "@/lib/registration-reads"
import {
  createLeagueRegistration, approveLeagueRegistration, rejectLeagueRegistration, withdrawLeagueRegistration,
  confirmLeagueRegistrationPayment, registerTeamSchema, confirmPaymentSchema,
  updateRegistrationSquad as updateRegistrationSquadCommand, updateSquadSchema,
} from "@/lib/registration-management"
import { bulkReviewLeagueRegistrations, type BulkReviewOperation } from "@/lib/registration-bulk"

async function mutationTenant(permission: Permission) {
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  return tenantId
}

export type RegisterTeamInput = z.input<typeof registerTeamSchema>

/** A league owner, or the team's manager/captain, registers a team for a tournament. */
export const registerTeam = withAuth("registration:create", async (input: RegisterTeamInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const data = registerTeamSchema.parse(input)
  const tenantId = await mutationTenant("registration:create")
  const created = await createLeagueRegistration(userId, tenantId, data)
  revalidatePath(`/dashboard/tournaments/${created.tournamentId}`)
  revalidatePath("/dashboard/registrations")
  return { success: true, registration: {
    id: created.id, status: created.status, tournamentId: created.tournamentId, teamId: created.teamId,
  } }
})

export const approveRegistration = withAuth("registration:manage", async (registrationId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(registrationId)
  const tenantId = await mutationTenant("registration:manage")
  const reg = await approveLeagueRegistration(userId, tenantId, registrationId)
  revalidatePath(`/dashboard/tournaments/${reg.tournamentId}`)
  revalidatePath("/dashboard/registrations")
  // PUB-06 cache invalidation: an approved entry joins the public team list.
  revalidatePath(`/tournaments/${reg.tournamentId}`)
  return { success: true, registration: { id: reg.id, status: reg.status } }
})

export const rejectRegistration = withAuth("registration:manage", async (registrationId: string, reason: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(registrationId)
  const tenantId = await mutationTenant("registration:manage")
  const reg = await rejectLeagueRegistration(userId, tenantId, registrationId, reason)
  revalidatePath(`/dashboard/tournaments/${reg.tournamentId}`)
  revalidatePath("/dashboard/registrations")
  revalidatePath(`/tournaments/${reg.tournamentId}`)
  return { success: true, registration: { id: reg.id, status: reg.status } }
})

/** Batch 120: bulk approve/reject for the console — composition of the SAME
 * audited single commands (each its own transaction + revalidation). The
 * per-item outcomes are returned verbatim; every successful item's surfaces
 * are revalidated. */
export const bulkReviewRegistrations = withAuth("registration:manage", async (
  operation: BulkReviewOperation, ids: string[], reason?: string,
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenantId = await mutationTenant("registration:manage")
  const { results } = await bulkReviewLeagueRegistrations(userId, tenantId, { operation, ids, reason })
  revalidatePath("/dashboard/registrations")
  for (const result of results) {
    if (result.ok) {
      revalidatePath(`/dashboard/tournaments/${result.tournamentId}`)
      revalidatePath(`/tournaments/${result.tournamentId}`)
    }
  }
  return { success: true, results }
})

/** A league owner, or the team's manager/captain, withdraws a pending/approved entry. */
export const withdrawRegistration = withAuth("registration:create", async (registrationId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(registrationId)
  const tenantId = await mutationTenant("registration:create")
  const reg = await withdrawLeagueRegistration(userId, tenantId, registrationId)
  revalidatePath(`/dashboard/tournaments/${reg.tournamentId}`)
  revalidatePath("/dashboard/registrations")
  // Withdrawal is the team-list removal path: a previously approved entry
  // must leave the public page immediately.
  revalidatePath(`/tournaments/${reg.tournamentId}`)
  return { success: true, registration: { id: reg.id, status: reg.status } }
})

/** League owners confirm off-platform team entry fees after checking receipt/reference. */
export const confirmRegistrationPayment = withAuth("registration:manage", async (
  registrationId: string,
  input: z.input<typeof confirmPaymentSchema>,
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(registrationId)
  const tenantId = await mutationTenant("registration:manage")
  const result = await confirmLeagueRegistrationPayment(userId, tenantId, registrationId, input)
  revalidatePath("/dashboard/registrations")
  return { success: true, ...result }
})

export type UpdateRegistrationSquadInput = z.input<typeof updateSquadSchema>

/**
 * ENH-05-03: the registered team's manager/captain (or the owner) corrects the
 * squad while the entry still awaits review. The service revalidates team
 * pointer authority, the active roster and the review transition itself — the
 * action only scopes the tenant and permission.
 */
export const updateRegistrationSquad = withAuth("registration:create", async (
  registrationId: string,
  input: UpdateRegistrationSquadInput,
) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  z.string().uuid().parse(registrationId)
  const tenantId = await mutationTenant("registration:create")
  const updated = await updateRegistrationSquadCommand(userId, tenantId, registrationId, input)
  // An identical replay is an honest pure read: no caches are invalidated as
  // if a change had landed.
  if (updated.changed) {
    revalidatePath(`/dashboard/tournaments/${updated.tournamentId}`)
    revalidatePath("/dashboard/registrations")
  }
  return { success: true, changed: updated.changed, registration: { id: updated.id, status: updated.status } }
})

/**
 * ENH-05-03 slice 4: the review console's squad editor loads the team's
 * ACTIVE players as id/name options. The read is tenant+team scoped and the
 * mutation-era permission is used so the affordance never outruns the edit
 * authority; the squad-update service revalidates every id anyway.
 */
export const getRegistrationSquadOptions = withAuth("registration:create", async (teamId: string) => {
  z.string().uuid().parse(teamId)
  const tenantId = await mutationTenant("registration:create")
  return readRegistrationSquadOptions(tenantId, teamId)
})

export const getRegistrations = withAuth("registration:manage", async (tournamentId?: string) => {
  if (tournamentId) z.string().uuid().parse(tournamentId)
  const { tenantId } = await requireRegistrationReadContext("registration:manage")
  return readRegistrations(tenantId, tournamentId ? { tournamentId } : {})
})

export const getMyRegistrations = withAuth("registration:create", async (tenantId: string) => {
  const context = await requireRegistrationReadContext("registration:create")
  if (tenantId !== context.tenantId) throw new Error("Invalid tenant")
  return readActorRegistrations(context.tenantId, context.actorId, {})
})

/** Active, registration-open leagues for the register-team picker. */
export const getRegistrationFormOptions = withAuth("registration:create", async () => {
  const { tenantId } = await requireRegistrationReadContext("registration:create")
  return readRegistrationTournamentOptions(tenantId)
})

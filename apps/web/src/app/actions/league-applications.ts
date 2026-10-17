"use server"

import { randomUUID } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import {
  db,
  users,
  tenants,
  leagueApplications,
  auditLogs,
  LEAGUE_APPLICATION_ACTIVE_STATES,
  leagueApplicationTransition,
  type LeagueApplication,
  type LeagueApplicationState,
} from "@mtk/database"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

/**
 * Applicant-facing side of the reviewed league onboarding (REG-01 first slice).
 *
 * An account that wants a reviewed onboarding files ONE active application
 * (enforced by a partial unique index), edits it as a draft, submits it, and
 * answers or withdraws it while the platform reviews. Approval and workspace
 * provisioning happen in the admin console route
 * (apps/admin/src/app/api/league-applications/route.ts); this module never
 * creates a league.
 *
 * All writes run under the applicant's `users` row lock — the same
 * serialization point `createTenant` uses — so a parallel self-service league
 * creation, approval, or second submission cannot double-provision or race the
 * one-league cap. Every mutation is audit-logged (LEAGUE_APPLICATION_*).
 */

const desiredPlanSchema = z.enum(["free", "starter", "pro", "enterprise"])
const expectedVersionSchema = z.number().int().min(0).max(2147483646)

const saveApplicationSchema = z.object({
  name: z.string().min(2, "League name must be at least 2 characters").max(120),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(60, "Slug must be 60 characters or fewer")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
  desiredPlan: desiredPlanSchema,
  // null = "I believe no active application exists", a number = the version the
  // applicant last saw. Either can be stale, and stale input is refused.
  expectedVersion: z.union([expectedVersionSchema, z.null()]),
})

const applicationKey = z.object({ expectedVersion: expectedVersionSchema })

export type SaveLeagueApplicationInput = z.infer<typeof saveApplicationSchema>

/** JSON-safe application shape handed to the client. */
export interface LeagueApplicationView {
  id: string
  state: LeagueApplicationState
  proposedName: string
  proposedSlug: string
  desiredPlan: "free" | "starter" | "pro" | "enterprise"
  version: number
  reviewReason: string | null
  submittedAt: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

const STALE = "This application changed in another window. Reload before continuing."
const DUPLICATE_SLUG = "This league URL is already taken. Please choose another."
const ALREADY_OWNS_LEAGUE = "You already have a league. Contact support to create another."
const NOT_EDITABLE = "This application can no longer be edited."
const TRANSITION_REFUSED = "This application is not in a state that allows that action. Reload to see its current status."

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function toView(application: LeagueApplication): LeagueApplicationView {
  return {
    id: application.id,
    state: application.state,
    proposedName: application.proposedName,
    proposedSlug: application.proposedSlug,
    desiredPlan: application.desiredPlan,
    version: application.version,
    reviewReason: application.reviewReason ?? null,
    submittedAt: application.submittedAt ? application.submittedAt.toISOString() : null,
    reviewedAt: application.reviewedAt ? application.reviewedAt.toISOString() : null,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  }
}

async function resolveApplicant() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const [dbUser] = await db
    .select({ id: users.id, isActive: users.isActive, role: users.role })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)

  if (!dbUser) {
    throw new Error("Your account is still being set up. Please refresh and try again.")
  }
  if (dbUser.isActive !== true) throw new Error("Your account is inactive")
  return dbUser
}

/**
 * Create or update the caller's active application.
 *
 * `expectedVersion === null` means "create"; a number means "replace exactly
 * this version". Both paths verify the truth inside the transaction, so a
 * second tab (or a replayed request) can never create a duplicate draft or
 * silently overwrite a submitted application.
 */
export async function saveLeagueApplication(input: SaveLeagueApplicationInput) {
  const applicant = await resolveApplicant()
  const parsed = saveApplicationSchema.parse({
    ...input,
    slug: input.slug ? input.slug : generateSlug(input.name),
  })

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${eq(users.id, applicant.id)} FOR UPDATE`)

    // A recorded owner does not need an application; the platform's
    // one-league cap is re-checked under the same lock the approval path takes.
    const [owned] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerId, applicant.id))
      .limit(1)
    if (owned) throw new Error(ALREADY_OWNS_LEAGUE)

    const [slugTaken] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, parsed.slug))
      .limit(1)
    if (slugTaken) throw new Error(DUPLICATE_SLUG)

    const [active] = await tx
      .select()
      .from(leagueApplications)
      .where(and(
        eq(leagueApplications.applicantId, applicant.id),
        inArray(leagueApplications.state, [...LEAGUE_APPLICATION_ACTIVE_STATES]),
      ))
      .for("update")
      .limit(1)

    const now = new Date()

    if (parsed.expectedVersion === null) {
      if (active) throw new Error(STALE)

      const [created] = await tx
        .insert(leagueApplications)
        .values({
          applicantId: applicant.id,
          proposedName: parsed.name,
          proposedSlug: parsed.slug,
          desiredPlan: parsed.desiredPlan,
          state: "draft",
          version: 0,
        })
        .returning()
      if (!created) throw new Error("Could not create the application. Try again.")

      await tx.insert(auditLogs).values({
        requestId: randomUUID(),
        tenantId: null,
        actorId: applicant.id,
        actorRole: applicant.role,
        method: "LEAGUE_APPLICATION_SAVE",
        path: "/dashboard/league/apply",
        statusCode: "200",
        payload: { applicationId: created.id, state: created.state, slug: created.proposedSlug },
      })
      return created
    }

    if (!active) throw new Error(STALE)
    if (active.state !== "draft" && active.state !== "needs_information") throw new Error(NOT_EDITABLE)
    if (active.version !== parsed.expectedVersion) throw new Error(STALE)

    const [updated] = await tx
      .update(leagueApplications)
      .set({
        proposedName: parsed.name,
        proposedSlug: parsed.slug,
        desiredPlan: parsed.desiredPlan,
        version: sql`${leagueApplications.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(leagueApplications.id, active.id),
        eq(leagueApplications.applicantId, applicant.id),
        eq(leagueApplications.version, parsed.expectedVersion),
        inArray(leagueApplications.state, ["draft", "needs_information"]),
      ))
      .returning()
    if (!updated) throw new Error(STALE)

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: null,
      actorId: applicant.id,
      actorRole: applicant.role,
      method: "LEAGUE_APPLICATION_SAVE",
      path: "/dashboard/league/apply",
      statusCode: "200",
      payload: { applicationId: updated.id, state: updated.state, slug: updated.proposedSlug },
    })
    return updated
  })

  revalidatePath("/dashboard/league/apply")
  return { success: true as const, application: toView(result) }
}

/** Submit a draft — or resubmit one the platform sent back for information. */
export async function submitLeagueApplication(input: { expectedVersion: number }) {
  const applicant = await resolveApplicant()
  const parsed = applicationKey.parse(input)

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${eq(users.id, applicant.id)} FOR UPDATE`)

    const [active] = await tx
      .select()
      .from(leagueApplications)
      .where(and(
        eq(leagueApplications.applicantId, applicant.id),
        inArray(leagueApplications.state, [...LEAGUE_APPLICATION_ACTIVE_STATES]),
      ))
      .for("update")
      .limit(1)
    if (!active) throw new Error("You do not have an application to submit.")

    const verdict = leagueApplicationTransition(active.state, "submit")
    if (verdict.outcome === "refused") throw new Error(TRANSITION_REFUSED)
    if (active.version !== parsed.expectedVersion) throw new Error(STALE)

    const now = new Date()
    const [updated] = await tx
      .update(leagueApplications)
      .set({
        state: "submitted",
        submittedAt: now,
        // A resubmission answers the previous request; the note is history in
        // the audit log, not standing state.
        reviewReason: null,
        version: sql`${leagueApplications.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(leagueApplications.id, active.id),
        eq(leagueApplications.applicantId, applicant.id),
        eq(leagueApplications.state, active.state),
        eq(leagueApplications.version, parsed.expectedVersion),
      ))
      .returning()
    if (!updated) throw new Error(STALE)

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: null,
      actorId: applicant.id,
      actorRole: applicant.role,
      method: "LEAGUE_APPLICATION_SUBMIT",
      path: "/dashboard/league/apply",
      statusCode: "200",
      payload: { applicationId: updated.id, state: updated.state, slug: updated.proposedSlug },
    })
    return updated
  })

  revalidatePath("/dashboard/league/apply")
  return { success: true as const, application: toView(result) }
}

/** Withdraw an application that has not been decided. Terminal; a new one may follow. */
export async function withdrawLeagueApplication(input: { expectedVersion: number }) {
  const applicant = await resolveApplicant()
  const parsed = applicationKey.parse(input)

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${eq(users.id, applicant.id)} FOR UPDATE`)

    const [active] = await tx
      .select()
      .from(leagueApplications)
      .where(and(
        eq(leagueApplications.applicantId, applicant.id),
        inArray(leagueApplications.state, [...LEAGUE_APPLICATION_ACTIVE_STATES]),
      ))
      .for("update")
      .limit(1)
    if (!active) throw new Error("You do not have an application to withdraw.")

    const verdict = leagueApplicationTransition(active.state, "withdraw")
    if (verdict.outcome === "refused") throw new Error(TRANSITION_REFUSED)
    if (active.version !== parsed.expectedVersion) throw new Error(STALE)

    const now = new Date()
    const [updated] = await tx
      .update(leagueApplications)
      .set({
        state: "withdrawn",
        version: sql`${leagueApplications.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(leagueApplications.id, active.id),
        eq(leagueApplications.applicantId, applicant.id),
        eq(leagueApplications.state, active.state),
        eq(leagueApplications.version, parsed.expectedVersion),
      ))
      .returning()
    if (!updated) throw new Error(STALE)

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: null,
      actorId: applicant.id,
      actorRole: applicant.role,
      method: "LEAGUE_APPLICATION_WITHDRAW",
      path: "/dashboard/league/apply",
      statusCode: "200",
      payload: { applicationId: updated.id, state: updated.state, slug: updated.proposedSlug },
    })
    return updated
  })

  revalidatePath("/dashboard/league/apply")
  return { success: true as const, application: toView(result) }
}

/**
 * The caller's latest application (any state) for the apply screen. Terminal
 * states are still returned so the applicant can read a rejection reason; the
 * page hides the form when a league is already owned.
 */
export async function getMyLeagueApplication(): Promise<{ application: LeagueApplicationView | null }> {
  const { userId } = await auth()
  if (!userId) return { application: null }

  const [dbUser] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)
  if (!dbUser || dbUser.isActive !== true) return { application: null }

  const [application] = await db
    .select()
    .from(leagueApplications)
    .where(eq(leagueApplications.applicantId, dbUser.id))
    .orderBy(desc(leagueApplications.createdAt))
    .limit(1)

  return { application: application ? toView(application) : null }
}

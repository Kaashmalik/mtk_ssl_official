"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getDashboardContext } from "@/lib/dashboard-context"
import { hasPermission } from "@/lib/rbac"
import {
  updateMemberRole, toggleMemberStatus, removeLeagueMember,
  memberRoleChangeSchema, memberStatusChangeSchema, memberRemovalSchema,
} from "@/lib/member-management"
import type { MemberRoleChange, MemberStatusChange, MemberRemoval } from "@/lib/member-management"
import { readMemberDirectory, readMemberDetails } from "@/lib/member-directory"
import { memberDirectoryRequest, memberDetailRequest, type MemberDirectoryRequest, type MemberDetailRequest } from "@/lib/member-directory-filters"
import { setMyDisplayTimeZone } from "@/lib/account-preferences"
import { setMyDisplayName } from "@/lib/profile-records"

export type { MemberRoleChange, MemberStatusChange, MemberRemoval }

/**
 * Resolves the acting account and the exact active league, then requires an
 * owner membership holding `user:manage`. The scoped reads/writes themselves live
 * in `lib/member-management.ts`; this module only owns Clerk/session resolution,
 * input parsing and navigation revalidation.
 */
async function requireMemberManager() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const access = await getDashboardContext(userId)
  if (access.status === "unavailable") throw new Error("League member access is unavailable. Please try again.")
  if (access.status !== "ready" || access.context.role !== "league_owner" || !hasPermission(access.context.role, "user:manage")) {
    throw new Error("Forbidden: league member management requires an active owner membership")
  }
  return { tenantId: access.context.tenantId, actorId: access.context.actorId, clerkId: userId }
}

export async function getMemberDirectory(input: MemberDirectoryRequest) {
  const { tenantId, ...filters } = memberDirectoryRequest.parse(input)
  const context = await requireMemberManager()
  if (tenantId !== context.tenantId) throw new Error("Workspace changed. Reload members before viewing.")
  return readMemberDirectory(context.tenantId, filters)
}

export async function getMemberDetails(input: MemberDetailRequest) {
  const parsed = memberDetailRequest.parse(input)
  const context = await requireMemberManager()
  if (parsed.tenantId !== context.tenantId) throw new Error("Workspace changed. Reload members before viewing.")
  return readMemberDetails(context.tenantId, parsed.membershipId)
}

export async function updateUserRole(input: MemberRoleChange) {
  const parsed = memberRoleChangeSchema.parse(input)
  const context = await requireMemberManager()
  const result = await updateMemberRole(parsed, context)
  revalidatePath("/dashboard", "layout")
  return result
}

/** Historical name retained; this changes league membership, never the account. */
export async function toggleUserStatus(input: MemberStatusChange) {
  const parsed = memberStatusChangeSchema.parse(input)
  const context = await requireMemberManager()
  const result = await toggleMemberStatus(parsed, context)
  revalidatePath("/dashboard", "layout")
  return result
}

/**
 * Remove a member from this league only. Historical players/statistics are not
 * deleted and the global account is untouched; the scope and lock ordering live
 * in `removeLeagueMember`.
 */
export async function removeMember(input: MemberRemoval) {
  const parsed = memberRemovalSchema.parse(input)
  const context = await requireMemberManager()
  const result = await removeLeagueMember(parsed, context)
  revalidatePath("/dashboard", "layout")
  return result
}

const displayTimeZoneSchema = z.object({ timeZone: z.string().nullable() })

/**
 * UX-03: set or clear the caller's personal display timezone (null = unset).
 * Deliberately OUTSIDE the league RBAC matrix: this belongs to the person,
 * not to any league role - the account-preferences writer enforces the
 * Clerk session, activity and Intl-zone validity itself. Both personal
 * surfaces that render dates revalidate in both directions.
 */
export async function updateMyDisplayTimeZone(input: unknown) {
  const parsed = displayTimeZoneSchema.parse(input)
  const result = await setMyDisplayTimeZone(parsed)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/account")
  return { success: true as const, timeZone: result.timeZone }
}

const displayNameSchema = z.object({ displayName: z.string().max(200) })

/**
 * REG-05 (Batch 142): set or clear the caller's display name (the writer's
 * policy normalizes honestly: trim + collapse, 60-char cap, empty = remove).
 * Personal surface, outside the league RBAC matrix; both revalidations cover
 * the account page and any league surfaces rendering the label.
 */
export async function updateMyDisplayName(input: unknown) {
  const parsed = displayNameSchema.parse(input)
  const result = await setMyDisplayName({ displayName: parsed.displayName })
  revalidatePath("/dashboard/account")
  return { success: true as const, displayName: result.displayName, changed: result.changed }
}

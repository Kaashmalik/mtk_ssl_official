"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { getDashboardContext } from "@/lib/dashboard-context"
import { hasPermission } from "@/lib/rbac"
import {
  readLeagueMembers, updateMemberRole, toggleMemberStatus, removeLeagueMember, setMemberExpiry,
  memberRoleChangeSchema, memberStatusChangeSchema, memberRemovalSchema, memberExpiryChangeSchema,
} from "@/lib/member-management"
import type { MemberRoleChange, MemberStatusChange, MemberRemoval, MemberExpiryChange } from "@/lib/member-management"
import { readMemberDirectory, readMemberDetails } from "@/lib/member-directory"
import { memberDirectoryRequest, memberDetailRequest, type MemberDirectoryRequest, type MemberDetailRequest } from "@/lib/member-directory-filters"

export type { MemberRoleChange, MemberStatusChange, MemberRemoval, MemberExpiryChange }

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

/** Administrative contact details are owner-only, not team-manager user:read. */
export async function getUsers(expectedTenantId?: string) {
  const context = await requireMemberManager()
  return readLeagueMembers(context.tenantId, expectedTenantId)
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

/**
 * Set or clear a member's bounded-access expiry (SCORE-09). An expired
 * membership stops granting access at the canonical scoring boundary; clearing
 * makes the membership unbounded again. Owner-only, audited, version-checked.
 */
export async function setUserMembershipExpiry(input: MemberExpiryChange) {
  const parsed = memberExpiryChangeSchema.parse(input)
  const context = await requireMemberManager()
  const result = await setMemberExpiry(parsed, context)
  revalidatePath("/dashboard", "layout")
  return result
}

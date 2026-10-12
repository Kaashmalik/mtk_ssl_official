import { db, matches, users } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { getUserRoleForTenant, requirePermissionServer } from "./rbac-server"

export async function canScoreMatch(clerkId: string, tenantId: string, match: { scorerId: string | null }) {
  const role = await getUserRoleForTenant(clerkId, tenantId)
  if (role === "league_owner" || role === "super_admin") return true
  if (role !== "scorer") return false
  const user = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  return !!user && match.scorerId === user.id
}

/** Role checks and assignment checks must use the exact mutation tenant. */
export async function requireMatchScoringAccess(clerkId: string, tenantId: string, matchId: string) {
  await requirePermissionServer("match:score", tenantId)
  const match = await db.query.matches.findFirst({
    where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
  })
  if (!match || match.tenantId !== tenantId) throw new Error("Match not found")
  if (!await canScoreMatch(clerkId, tenantId, match)) {
    throw new Error("Forbidden: You are not the assigned scorer for this match")
  }
  return match
}

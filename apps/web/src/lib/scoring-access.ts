import { db, matches, users } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { getUserRoleForTenant, requirePermissionServer } from "./rbac-server"
import { z } from "zod"

/** Clerk session identity -> provisioned database UUID; never a client argument. */
export async function requireScoringActorId(clerkId: string): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkId), columns: { id: true, isActive: true },
  })
  if (!user || user.isActive !== true || !z.string().uuid().safeParse(user.id).success) {
    throw new Error("Scoring account is unavailable or inactive")
  }
  return user.id
}

/** Either the primary or the backup assigned scorer may record for the match. */
export async function canScoreMatch(clerkId: string, tenantId: string, match: { scorerId: string | null; backupScorerId?: string | null }) {
  const role = await getUserRoleForTenant(clerkId, tenantId)
  if (!["league_owner", "scorer"].includes(role ?? "")) return false
  const user = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!user || user.isActive !== true) return false
  return role === "league_owner" || match.scorerId === user.id || match.backupScorerId === user.id
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

import { randomUUID } from "crypto"
import { db, matches, users, tenants, userTenantRoles, teams, auditLogs } from "@mtk/database"
import { and, eq, inArray, sql } from "drizzle-orm"

type Match = typeof matches.$inferSelect
type LifecyclePatch = Partial<Pick<Match, "status" | "tossWinnerId" | "tossDecision" | "startDate">>

/** Product-side pre-match commands only. Completion belongs to scoring-service.
 * Keep match -> users -> league -> membership -> teams order aligned with scoring.
 */
export async function mutateMatchLifecycle(clerkId: string, tenantId: string, matchId: string,
  method: "MATCH_TOSS_SET" | "MATCH_START", patchFor: (match: Match) => LifecyclePatch | null) {
  return db.transaction(async tx => {
    const key = and(eq(matches.id, matchId), eq(matches.tenantId, tenantId))
    await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
    const match = await tx.query.matches.findFirst({ where: key })
    if (!match || match.id !== matchId || match.tenantId !== tenantId) throw new Error("Match not found")
    const initialActor = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
    if (!initialActor) throw new Error("Forbidden: scoring account not found")
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initialActor.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.userId, initialActor.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.id, initialActor.id) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    const member = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, initialActor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    if (!actor || actor.id !== initialActor.id || actor.isActive !== true || actor.clerkId !== clerkId
      || !league || league.id !== tenantId || league.isActive !== true
      || !member || member.userId !== actor.id || member.tenantId !== tenantId || member.status !== "active"
      || !(member.role === "league_owner" || (member.role === "scorer"
        && (match.scorerId === actor.id || match.backupScorerId === actor.id)))) {
      throw new Error("Forbidden: your match lifecycle access changed")
    }
    if (match.teamAId === match.teamBId) throw new Error("Match requires two distinct teams")
    const ids = [match.teamAId, match.teamBId].sort()
    await tx.execute(sql`SELECT ${teams.id} FROM ${teams}
      WHERE ${and(eq(teams.tenantId, tenantId), inArray(teams.id, ids))} ORDER BY ${teams.id} FOR SHARE`)
    for (const id of ids) {
      const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, id), eq(teams.tenantId, tenantId)) })
      if (!team || team.id !== id || team.tenantId !== tenantId || team.isActive !== true) {
        throw new Error("Match team is unavailable in this league")
      }
    }
    const patch = patchFor(match)
    if (!patch) return match // Reauthorize retries; never rewrite timestamps.
    const [updated] = await tx.update(matches).set({ ...patch, updatedAt: new Date() }).where(key).returning()
    if (!updated) throw new Error("Match changed. Reload before saving.")
    const snapshot = (row: Match) => ({ status: row.status, tossWinnerId: row.tossWinnerId,
      tossDecision: row.tossDecision, startDate: row.startDate })
    await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: actor.id,
      actorRole: member.role, method, path: `/dashboard/matches/${matchId}`, statusCode: "200",
      payload: { matchId, before: snapshot(match), after: snapshot(updated) } })
    return updated
  }, { isolationLevel: "read committed" })
}

import { randomUUID } from "crypto"
import { db, users, tenants, userTenantRoles, teams, players, matches, auditLogs, membershipGrantsAccess } from "@mtk/database"
import { and, eq, or, inArray, sql } from "drizzle-orm"

/** Archival only: never delete identity/history or detach memberships/rosters.
 * Account -> league -> membership -> team -> player. Match reads MUST NOT take
 * row locks after accounts/resources (canonical scoring locks match first).
 */
export async function archiveRosterResource(clerkId: string, tenantId: string, kind: "team" | "player", id: string) {
  return db.transaction(async tx => {
    const initial = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
    if (!initial) throw new Error("Forbidden: archive account not found")
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initial.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
    const actor = await tx.query.users.findFirst({ where: eq(users.id, initial.id) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
    const member = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId)) })
    if (!actor || actor.id !== initial.id || actor.clerkId !== clerkId || actor.isActive !== true
      || !league || league.id !== tenantId || league.isActive !== true
      || !member || member.userId !== actor.id || member.tenantId !== tenantId
      || !membershipGrantsAccess(member) || member.role !== "league_owner") throw new Error("Forbidden: your archive access changed")

    // Discover a player's team first, then verify the link again after locking
    // team -> player. Never chase a changed link by taking another team lock.
    const initialPlayer = kind === "player" ? await tx.query.players.findFirst({
      where: and(eq(players.id, id), eq(players.tenantId, tenantId)) }) : undefined
    if (kind === "player" && (!initialPlayer || initialPlayer.id !== id || initialPlayer.tenantId !== tenantId)) {
      throw new Error("Player not found")
    }
    const teamId = kind === "team" ? id : initialPlayer!.teamId
    if (teamId) {
      await tx.execute(sql`SELECT ${teams.id} FROM ${teams}
        WHERE ${and(eq(teams.id, teamId), eq(teams.tenantId, tenantId))} FOR UPDATE`)
      const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)) })
      if (!team || team.id !== teamId || team.tenantId !== tenantId) throw new Error("Team not found in this league")
      if (kind === "team" && team.isActive === false) return { success: true as const, archived: true as const }
    }
    let player: typeof players.$inferSelect | undefined
    if (kind === "player") {
      await tx.execute(sql`SELECT ${players.id} FROM ${players}
        WHERE ${and(eq(players.id, id), eq(players.tenantId, tenantId))} FOR UPDATE`)
      player = await tx.query.players.findFirst({ where: and(eq(players.id, id), eq(players.tenantId, tenantId)) })
      if (!player || player.id !== id || player.tenantId !== tenantId) throw new Error("Player not found")
      if (player.teamId !== teamId) throw new Error("Player team changed. Reload before archiving.")
      if (player.isActive === false && player.status === "inactive") return { success: true as const, archived: true as const }
    }
    if (teamId) {
      // Plain READ COMMITTED read after the team lock sees a fixture creation
      // that committed while we waited. No match locks / lock-order inversion.
      const fixture = await tx.query.matches.findFirst({ columns: { id: true }, where: and(
        eq(matches.tenantId, tenantId), or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)),
        inArray(matches.status, ["scheduled", "toss", "live", "innings_break"])) })
      if (fixture) throw new Error("Finish or cancel unfinished fixtures before archiving this team or its players")
    }
    let before: { isActive: boolean; status?: string }
    let after: { isActive: boolean; status?: string }
    if (kind === "team") {
      // Team was checked under the lock above. Do not lock/update its players.
      const [updated] = await tx.update(teams).set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId))).returning()
      if (!updated) throw new Error("Team changed. Reload before archiving.")
      before = { isActive: true }
      after = { isActive: updated.isActive }
    } else {
      const [updated] = await tx.update(players).set({ isActive: false, status: "inactive", updatedAt: new Date() })
        .where(and(eq(players.id, id), eq(players.tenantId, tenantId))).returning()
      if (!updated) throw new Error("Player changed. Reload before archiving.")
      before = { isActive: player!.isActive, status: player!.status }
      after = { isActive: updated.isActive, status: updated.status }
    }
    await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: member.role,
      method: kind === "team" ? "TEAM_ARCHIVE" : "PLAYER_ARCHIVE", path: `/dashboard/${kind === "team" ? "teams" : "players"}/${id}`,
      statusCode: "200", payload: { resourceId: id, before, after } })
    return { success: true as const, archived: true as const }
  }, { isolationLevel: "read committed" })
}

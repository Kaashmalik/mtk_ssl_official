import { randomUUID } from "crypto"
import { db, users, tenants, userTenantRoles, teams, players, tournaments, matches, auditLogs,
  checkPlanLimit, type PlanKey, type Team, type Player } from "@mtk/database"
import { and, eq, inArray, or, count, sql } from "drizzle-orm"
import { z } from "zod"
import { teamInput, teamPatch, playerInput, playerPatch } from "./roster-input"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Operation = "TEAM_CREATE" | "TEAM_UPDATE" | "PLAYER_CREATE" | "PLAYER_UPDATE" | "ROSTER_ADD" | "ROSTER_REMOVE"

// Participating writers lock account -> league -> membership -> sorted teams
// -> player. READ COMMITTED reads after waits must recheck current authority and
// references. Never take match locks here: canonical scoring locks match first.
// Other/admin writers still need auditing; these helpers are not DB constraints.
async function actorContext(tx: Tx, clerkId: string, tenantId: string, operation: Operation) {
  const initial = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!initial) throw new Error("Forbidden: roster account not found")
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initial.id} FOR UPDATE`)
  // All participating creates serialize counts on the league row; inactive
  // records still consume quota. No existing match is locked by these commands.
  await tx.execute(operation.endsWith("CREATE")
    ? sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR UPDATE`
    : sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
  const actor = await tx.query.users.findFirst({ where: eq(users.id, initial.id) })
  const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  const member = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId)) })
  const mayDelegate = ["TEAM_UPDATE", "ROSTER_ADD", "ROSTER_REMOVE"].includes(operation)
  if (!actor || actor.id !== initial.id || actor.clerkId !== clerkId || actor.isActive !== true
    || !league || league.id !== tenantId || league.isActive !== true
    || !member || member.userId !== actor.id || member.tenantId !== tenantId || member.status !== "active"
    || !(member.role === "league_owner" || (mayDelegate && member.role === "team_manager"))) {
    throw new Error("Forbidden: your roster access changed")
  }
  return { actor, league, member }
}
type Context = Awaited<ReturnType<typeof actorContext>>

async function lockedTeams(tx: Tx, tenantId: string, ids: string[]) {
  const sorted = [...new Set(ids)].sort()
  if (sorted.length) await tx.execute(sql`SELECT ${teams.id} FROM ${teams}
    WHERE ${and(eq(teams.tenantId, tenantId), inArray(teams.id, sorted))} ORDER BY ${teams.id} FOR UPDATE`)
  const rows = new Map<string, Team>()
  for (const id of sorted) {
    const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, id), eq(teams.tenantId, tenantId)) })
    if (!team || team.id !== id || team.tenantId !== tenantId || team.isActive !== true) throw new Error("Team is unavailable in this league")
    rows.set(id, team)
  }
  return rows
}
function requireTeamAuthority(context: Context, team: Team) {
  if (context.member.role !== "league_owner" && team.managerId !== context.actor.id && team.captainId !== context.actor.id) {
    throw new Error("You can only manage the team currently assigned to you")
  }
}
async function tournamentReference(tx: Tx, tenantId: string, id: string | null | undefined) {
  if (!id) return
  await tx.execute(sql`SELECT ${tournaments.id} FROM ${tournaments}
    WHERE ${and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId))} FOR SHARE`)
  const row = await tx.query.tournaments.findFirst({ where: and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)) })
  if (!row || row.id !== id || row.tenantId !== tenantId || !["draft", "registration", "live"].includes(row.status)) {
    throw new Error("Tournament is unavailable in this league")
  }
}
async function rosterSize(tx: Tx, tenantId: string, teamId: string) {
  const [row] = await tx.select({ total: count() }).from(players).where(and(eq(players.tenantId, tenantId), eq(players.teamId, teamId)))
  return Number(row.total)
}
async function requireCapacity(tx: Tx, tenantId: string, team: Team) {
  if (team.maxSquadSize !== null && await rosterSize(tx, tenantId, team.id) >= team.maxSquadSize) {
    throw new Error(`This team has reached its ${team.maxSquadSize}-player squad limit`)
  }
}
async function requireNotPlaying(tx: Tx, tenantId: string, ids: string[]) {
  if (!ids.length) return
  // Plain current reads AFTER resource locks, never match locks after accounts.
  const match = await tx.query.matches.findFirst({ columns: { id: true }, where: and(eq(matches.tenantId, tenantId),
    or(inArray(matches.teamAId, ids), inArray(matches.teamBId, ids)), inArray(matches.status, ["toss", "live", "innings_break"])) })
  if (match) throw new Error("Roster eligibility cannot change while the team is playing")
}
async function audit(tx: Tx, context: Context, tenantId: string, method: Operation, resourceId: string,
  before: unknown, after: unknown, changedFields: string[]) {
  // Do not replicate names/contact/DOB/biographies into audit payloads.
  await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id, actorRole: context.member.role,
    method, path: `/dashboard/${method.startsWith("TEAM") ? "teams" : "players"}/${resourceId}`, statusCode: "200",
    payload: { resourceId, before, after, changedFields } })
}
function teamSnapshot(team: Team) { return { tournamentId: team.tournamentId, maxSquadSize: team.maxSquadSize, isActive: team.isActive } }
function playerSnapshot(player: Player) { return { teamId: player.teamId, status: player.status, isActive: player.isActive } }
function clean<T extends object>(data: T): T { return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T }
function slugFor(name: string) {
  const slug = name.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 50).replace(/-+$/, "")
  return slug.length >= 2 ? slug : `team-${randomUUID()}`
}

export async function createRosterTeam(clerkId: string, tenantId: string, input: z.infer<typeof teamInput>) {
  const { tenantId: supplied, ...data } = teamInput.parse(input)
  if (supplied && supplied !== tenantId) throw new Error("Invalid tenant")
  return db.transaction(async tx => {
    const context = await actorContext(tx, clerkId, tenantId, "TEAM_CREATE")
    const [row] = await tx.select({ total: count() }).from(teams).where(eq(teams.tenantId, tenantId))
    checkPlanLimit({ plan: context.league.plan as PlanKey, feature: "maxTeams", current: Number(row.total) })
    await tournamentReference(tx, tenantId, data.tournamentId)
    const [team] = await tx.insert(teams).values({ ...data, tenantId, slug: data.slug ?? slugFor(data.name),
      maxSquadSize: data.maxSquadSize ?? 15, createdBy: context.actor.id }).returning()
    if (!team) throw new Error("Team creation failed")
    await audit(tx, context, tenantId, "TEAM_CREATE", team.id, null, teamSnapshot(team), Object.keys(clean(data)))
    return team
  }, { isolationLevel: "read committed" })
}
export async function updateRosterTeam(clerkId: string, tenantId: string, id: string, input: z.infer<typeof teamPatch>) {
  const data = clean(teamPatch.parse(input))
  return db.transaction(async tx => {
    const context = await actorContext(tx, clerkId, tenantId, "TEAM_UPDATE")
    const team = (await lockedTeams(tx, tenantId, [id])).get(id)!
    requireTeamAuthority(context, team)
    if (data.tournamentId !== undefined && data.tournamentId !== team.tournamentId) {
      if (context.member.role !== "league_owner") throw new Error("Only a league owner can change tournament linkage")
      await tournamentReference(tx, tenantId, data.tournamentId)
    }
    if (data.maxSquadSize !== undefined && await rosterSize(tx, tenantId, id) > data.maxSquadSize) {
      throw new Error("Squad capacity cannot be lower than the current linked roster")
    }
    if (!Object.keys(data).length) return team
    const [updated] = await tx.update(teams).set({ ...data,
      ...(data.name && !data.slug ? { slug: slugFor(data.name) } : {}), updatedAt: new Date() })
      .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId))).returning()
    if (!updated) throw new Error("Team changed. Reload before saving.")
    await audit(tx, context, tenantId, "TEAM_UPDATE", id, teamSnapshot(team), teamSnapshot(updated), Object.keys(data))
    return updated
  }, { isolationLevel: "read committed" })
}
export async function createRosterPlayer(clerkId: string, tenantId: string, input: z.infer<typeof playerInput>) {
  const { tenantId: supplied, ...data } = playerInput.parse(input)
  if (supplied && supplied !== tenantId) throw new Error("Invalid tenant")
  return db.transaction(async tx => {
    const context = await actorContext(tx, clerkId, tenantId, "PLAYER_CREATE")
    const [row] = await tx.select({ total: count() }).from(players).where(eq(players.tenantId, tenantId))
    checkPlanLimit({ plan: context.league.plan as PlanKey, feature: "maxPlayers", current: Number(row.total) })
    if (data.teamId) {
      if (data.status !== undefined && data.status !== "active") throw new Error("Only active players may join a roster")
      const team = (await lockedTeams(tx, tenantId, [data.teamId])).get(data.teamId)!
      await requireNotPlaying(tx, tenantId, [team.id])
      await requireCapacity(tx, tenantId, team)
    }
    const [player] = await tx.insert(players).values({ ...data, tenantId, createdBy: context.actor.id }).returning()
    if (!player) throw new Error("Player creation failed")
    await audit(tx, context, tenantId, "PLAYER_CREATE", player.id, null, playerSnapshot(player), Object.keys(clean(data)))
    return player
  }, { isolationLevel: "read committed" })
}

type PlayerCommand = { kind: "PLAYER_UPDATE"; id: string; data: z.infer<typeof playerPatch> }
  | { kind: "ROSTER_ADD" | "ROSTER_REMOVE"; id: string; teamId: string }
export async function mutateRosterPlayer(clerkId: string, tenantId: string, command: PlayerCommand) {
  const data: z.infer<typeof playerPatch> = command.kind === "PLAYER_UPDATE" ? clean(playerPatch.parse(command.data)) : {}
  return db.transaction(async tx => {
    const context = await actorContext(tx, clerkId, tenantId, command.kind)
    const key = and(eq(players.id, command.id), eq(players.tenantId, tenantId))
    const initial = await tx.query.players.findFirst({ where: key })
    if (!initial || initial.id !== command.id || initial.tenantId !== tenantId) throw new Error("Player not found")
    const target = command.kind === "PLAYER_UPDATE" ? (data.teamId !== undefined ? data.teamId : initial.teamId)
      : command.kind === "ROSTER_ADD" ? command.teamId : null
    const ids = [...new Set([initial.teamId, target, ...(command.kind !== "PLAYER_UPDATE" ? [command.teamId] : [])]
      .filter((value): value is string => !!value))].sort()
    const locked = await lockedTeams(tx, tenantId, ids)
    if (command.kind !== "PLAYER_UPDATE") requireTeamAuthority(context, locked.get(command.teamId)!)
    await tx.execute(sql`SELECT ${players.id} FROM ${players} WHERE ${key} FOR UPDATE`)
    const player = await tx.query.players.findFirst({ where: key })
    if (!player || player.id !== command.id || player.tenantId !== tenantId) throw new Error("Player not found")
    if (player.teamId !== initial.teamId) throw new Error("Player team changed. Reload before saving.")
    if (command.kind === "PLAYER_UPDATE" && player.isActive !== true) throw new Error("Archived players cannot be edited")
    if (command.kind === "ROSTER_REMOVE" && player.teamId && player.teamId !== command.teamId) throw new Error("Player not found in this team")
    if (command.kind === "ROSTER_ADD" && (player.isActive !== true || player.status !== "active")) throw new Error("Only active players may join a roster")
    if (target && target !== player.teamId && (data.status ?? player.status) !== "active") throw new Error("Only active players may join a roster")
    if (player.teamId && target && player.teamId !== target) throw new Error("Remove the player from their current team before moving them")
    const patch = command.kind === "PLAYER_UPDATE" ? data : { teamId: target }
    const eligibilityChange = target !== player.teamId || (data.status !== undefined && data.status !== player.status)
    if (eligibilityChange) await requireNotPlaying(tx, tenantId, ids)
    if (target && target !== player.teamId) await requireCapacity(tx, tenantId, locked.get(target)!)
    if (!Object.keys(patch).length || (command.kind !== "PLAYER_UPDATE" && target === player.teamId)) return player
    const [updated] = await tx.update(players).set({ ...patch, updatedAt: new Date() }).where(key).returning()
    if (!updated) throw new Error("Player changed. Reload before saving.")
    await audit(tx, context, tenantId, command.kind, player.id, playerSnapshot(player), playerSnapshot(updated), Object.keys(patch))
    return updated
  }, { isolationLevel: "read committed" })
}

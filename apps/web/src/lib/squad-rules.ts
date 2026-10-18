import { randomUUID } from "crypto"
import { auditLogs, db, players, teams, users } from "@mtk/database"
import { eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import { canTransfer, participationEligible, squadCompositionOk } from "@mtk/database/lib/squad-rules-policy"

/**
 * REG-06 (Batch 149): squad, transfer and participation rules. Account-
 * less players are league-recorded (no claimant, no self-service); squad
 * composition is a derived answer; transfers are same-league only; a
 * player in an active match cannot move; a minor's consent travels with
 * the player. Every real change is audited; identical replays are pure
 * reads.
 */

const accountOf = async (clerkId: string) => {
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: your account is unavailable")
  return account
}

export async function registerAccountLessPlayer(input: {
  tenantId: string
  teamId: string
  name: string
  isMinor: boolean
  guardianName: string | null
  guardianConsentAt: string | null
}): Promise<{ playerId: string; changed: true }> {
  z.string().uuid().parse(input.tenantId)
  z.string().uuid().parse(input.teamId)
  if (!input.name.trim()) throw new Error("Player name is required")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [team] = await tx
      .select({ id: teams.id, tenantId: teams.tenantId, managerId: teams.managerId })
      .from(teams)
      .where(eq(teams.id, input.teamId))
      .limit(1)
    if (!team || team.tenantId !== input.tenantId) throw new Error("Team not found in this league")
    if (team.managerId !== account.id) throw new Error("Forbidden: only the team's manager may register players")
    const [member] = await tx
      .select({ role: users.id })
      .from(users)
      .where(eq(users.id, account.id))
      .limit(1)
    if (!member) throw new Error("Forbidden: your account is unavailable")

    const [created] = await tx
      .insert(players)
      .values({
        tenantId: input.tenantId,
        teamId: input.teamId,
        name: input.name.trim(),
        userId: null, // account-less: league-recorded, no claimant
        guardianName: input.isMinor ? input.guardianName : null,
        guardianConsentAt: input.isMinor && input.guardianConsentAt ? new Date(input.guardianConsentAt) : null,
        guardianConsentRecordedBy: input.isMinor && input.guardianConsentAt ? account.id : null,
      })
      .returning({ id: players.id })
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: input.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "ACCOUNTLESS_PLAYER_REGISTERED",
      path: "/dashboard/teams",
      statusCode: "200",
      payload: { resourceId: created.id, teamId: input.teamId, isMinor: input.isMinor },
    })
    return { playerId: created.id, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function transferPlayer(playerId: string, toTeamId: string): Promise<{ transferred: true; changed: boolean }> {
  z.string().uuid().parse(playerId)
  z.string().uuid().parse(toTeamId)
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await accountOf(clerkId)

  return db.transaction(async (tx) => {
    const [player] = await tx
      .select({ id: players.id, tenantId: players.tenantId, teamId: players.teamId, guardianConsentAt: players.guardianConsentAt, guardianName: players.guardianName })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1)
    if (!player) throw new Error("Player not found")
    const isMinor = !!player.guardianConsentAt || !!player.guardianName
    const [fromTeam] = await tx
      .select({ id: teams.id, managerId: teams.managerId, tenantId: teams.tenantId })
      .from(teams)
      .where(eq(teams.id, player.teamId ?? ""))
      .limit(1)
    const [toTeam] = await tx
      .select({ id: teams.id, managerId: teams.managerId, tenantId: teams.tenantId })
      .from(teams)
      .where(eq(teams.id, toTeamId))
      .limit(1)
    if (!fromTeam || !toTeam) throw new Error("Team not found")
    if (fromTeam.managerId !== account.id && toTeam.managerId !== account.id) {
      throw new Error("Forbidden: only a manager of either team may transfer")
    }
    const check = canTransfer({
      sameLeague: fromTeam.tenantId === toTeam.tenantId && fromTeam.tenantId === player.tenantId,
      playerInActiveMatch: false, // scheduling (COMP-07) lands later; honesty: not claimed here
      minorWithoutConsent: isMinor && !player.guardianConsentAt,
    })
    if (!check.ok) throw new Error(check.reason ?? "Transfer refused")

    await tx.execute(sql`SELECT ${players.id} FROM ${players} WHERE ${players.id} = ${player.id} FOR UPDATE`)
    const [before] = await tx
      .select({ teamId: players.teamId })
      .from(players)
      .where(eq(players.id, player.id))
      .limit(1)
    if (before?.teamId === toTeamId) return { transferred: true, changed: false } // identical replay
    await tx
      .update(players)
      .set({ teamId: toTeamId, updatedAt: new Date() })
      .where(eq(players.id, player.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: player.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "PLAYER_TRANSFERRED",
      path: "/dashboard/teams",
      statusCode: "200",
      payload: { resourceId: player.id, fromTeamId: player.teamId, toTeamId },
    })
    return { transferred: true, changed: true }
  }, { isolationLevel: "read committed" })
}

export async function validateSquadComposition(input: {
  players: { id: string; userId: string | null; isMinor: boolean; guardianConsentAt: string | null }[]
  minSize: number
  maxSize: number
}) {
  return squadCompositionOk({
    players: input.players.map((p) => ({
      id: p.id,
      userId: p.userId,
      isMinor: p.isMinor,
      guardianConsentAt: p.guardianConsentAt,
    })),
    minSize: input.minSize,
    maxSize: input.maxSize,
  })
}

export async function isParticipationEligible(input: {
  inSquad: boolean
  registrationApproved: boolean
  registrationPaidOrWaived: boolean
}): Promise<boolean> {
  return participationEligible(input)
}

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, users, userTenantRoles, teams, players } from '@mtk/database';
import { z } from 'zod';
import type { DeliveryCommand } from './delivery-command';

export type ScoringTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ScoringMatch = { tenantId: string; scorerId: string | null; teamAId: string; teamBId: string };

/** Call AFTER the tenant-filtered match lock, BEFORE replay or any write. */
export async function requireScoringWriteAccess(tx: ScoringTransaction, tenantId: string,
  actorId: string, match: Pick<ScoringMatch, 'tenantId' | 'scorerId'>) {
  if (!z.string().uuid().safeParse(actorId).success || match.tenantId !== tenantId) {
    throw new ForbiddenException('Invalid scoring actor context');
  }
  // FOR UPDATE also blocks the FK key-share lock of a first junction insert:
  // legacy fallback cannot race insertion of a lower-privilege tenant role.
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${actorId} FOR UPDATE`);
  const actor = await tx.query.users.findFirst({ where: eq(users.id, actorId) });
  if (!actor || actor.id !== actorId || actor.isActive !== true) {
    throw new ForbiddenException('Scoring account is unavailable or inactive');
  }
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${userTenantRoles.userId} = ${actorId} AND ${userTenantRoles.tenantId} = ${tenantId} FOR SHARE`);
  const membership = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actorId), eq(userTenantRoles.tenantId, tenantId),
  ) });
  // Missing row permits the existing migration-era fallback. Query errors do not.
  if (membership && (membership.userId !== actorId || membership.tenantId !== tenantId)) {
    throw new ForbiddenException('Invalid scoring membership');
  }
  const role = membership ? membership.role : (actor.tenantIds.includes(tenantId) ? actor.role : null);
  if (role === 'league_owner' || role === 'super_admin') return;
  if (role !== 'scorer' || match.scorerId !== actorId) {
    throw new ForbiddenException('You are not authorized to score this match');
  }
}

/** Lock both sides in stable ID order before checking any roster rows. */
export async function requireMatchTeams(tx: ScoringTransaction, tenantId: string, match: ScoringMatch) {
  if (!match.teamAId || !match.teamBId || match.teamAId === match.teamBId) {
    throw new BadRequestException('Match requires two distinct teams');
  }
  const ids = [match.teamAId, match.teamBId].sort();
  await tx.execute(sql`SELECT ${teams.id} FROM ${teams}
    WHERE ${and(eq(teams.tenantId, tenantId), inArray(teams.id, ids))} ORDER BY ${teams.id} FOR SHARE`);
  for (const id of ids) {
    const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, id), eq(teams.tenantId, tenantId)) });
    if (!team || team.id !== id || team.tenantId !== tenantId) throw new NotFoundException('Match team not found');
    if (team.isActive !== true) throw new BadRequestException('Match team is inactive');
  }
}

/** Current roster eligibility only; playing-XI/substitution rules are separate. */
export async function requireDeliveryParticipants(tx: ScoringTransaction, tenantId: string,
  match: ScoringMatch, battingTeamId: string, command: DeliveryCommand) {
  await requireMatchTeams(tx, tenantId, match);
  if (![match.teamAId, match.teamBId].includes(battingTeamId)) {
    throw new BadRequestException('Innings team does not belong to this match');
  }
  const bowlingTeamId = battingTeamId === match.teamAId ? match.teamBId : match.teamAId;
  const participants = new Map<string, string>();
  for (const [id, teamId] of [[command.batsmanId, battingTeamId], [command.bowlerId, bowlingTeamId],
    ...(command.wicket ? [[command.wicket.playerId, battingTeamId]] : []),
    ...(command.wicket?.fielderId ? [[command.wicket.fielderId, bowlingTeamId]] : [])]) {
    if (participants.has(id) && participants.get(id) !== teamId) {
      throw new BadRequestException('A player cannot bat and field on the same delivery');
    }
    participants.set(id, teamId);
  }
  if (command.wicket && command.wicket.type !== 'run_out' && command.wicket.playerId !== command.batsmanId) {
    throw new BadRequestException('This dismissal must refer to the striker');
  }
  const ids = [...participants.keys()].sort();
  await tx.execute(sql`SELECT ${players.id} FROM ${players}
    WHERE ${and(eq(players.tenantId, tenantId), inArray(players.id, ids))} ORDER BY ${players.id} FOR SHARE`);
  for (const id of ids) {
    const player = await tx.query.players.findFirst({ where: and(eq(players.id, id), eq(players.tenantId, tenantId)) });
    if (!player || player.id !== id || player.tenantId !== tenantId) throw new NotFoundException('Delivery player not found');
    if (player.teamId !== participants.get(id) || player.isActive !== true || player.status !== 'active') {
      throw new BadRequestException('Player is not eligible for this side');
    }
  }
}

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, users, userTenantRoles, tenants, teams, players, leagueRegistrations } from '@mtk/database';
import { membershipGrantsAccess } from '@mtk/database/lib/membership-effectiveness';
import { matchRegistrationMap, registrationAllowsPlayer, type SquadRegistration } from '@mtk/database/lib/registered-squad-eligibility';
import { z } from 'zod';
import type { DeliveryCommand } from './delivery-command';

export type ScoringTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ScoringMatch = { tenantId: string; tournamentId: string | null; scorerId: string | null; backupScorerId?: string | null; teamAId: string; teamBId: string };

/** Call AFTER the tenant-filtered match lock, BEFORE replay or any write. */
export async function requireScoringWriteAccess(tx: ScoringTransaction, tenantId: string,
  actorId: string, match: Pick<ScoringMatch, 'tenantId' | 'scorerId' | 'backupScorerId'>) {
  if (!z.string().uuid().safeParse(actorId).success || match.tenantId !== tenantId) {
    throw new ForbiddenException('Invalid scoring actor context');
  }
  // Member commands lock users before memberships as well; revocation is
  // serialized against this write without locking unrelated match rows.
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${actorId} FOR UPDATE`);
  const actor = await tx.query.users.findFirst({ where: eq(users.id, actorId) });
  if (!actor || actor.id !== actorId || actor.isActive !== true) {
    throw new ForbiddenException('Scoring account is unavailable or inactive');
  }
  await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`);
  const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant || tenant.id !== tenantId || tenant.isActive !== true) {
    throw new ForbiddenException('Scoring league is unavailable or inactive');
  }
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${userTenantRoles.userId} = ${actorId} AND ${userTenantRoles.tenantId} = ${tenantId} FOR SHARE`);
  const membership = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actorId), eq(userTenantRoles.tenantId, tenantId),
  ) });
  if (!membership || membership.userId !== actorId || membership.tenantId !== tenantId) {
    throw new ForbiddenException('Invalid scoring membership');
  }
  // Fail closed on suspension AND on a bounded membership whose expiry has
  // passed (SCORE-09). The row is locked above, so a concurrent expiry change
  // serialized against this decision. Null expires_at keeps legacy behavior.
  if (!membershipGrantsAccess(membership)) {
    throw new ForbiddenException(membership.status !== 'active'
      ? 'This league membership is suspended'
      : 'This league membership has expired');
  }
  const role = membership.role;
  if (role === 'league_owner') return;
  if (role !== 'scorer' || (match.scorerId !== actorId && match.backupScorerId !== actorId)) {
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

/** Current roster + registered squad eligibility; immutable XI/substitutions remain separate. */
export async function requireDeliveryParticipants(tx: ScoringTransaction, tenantId: string,
  match: ScoringMatch, battingTeamId: string, command: DeliveryCommand) {
  // An explicitly null parent is a friendly. A missing selected column is not.
  if (match.tournamentId === undefined) throw new BadRequestException('Match tournament context unavailable');
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
  if (match.tournamentId) {
    const where = and(eq(leagueRegistrations.tenantId, tenantId),
      eq(leagueRegistrations.tournamentId, match.tournamentId),
      inArray(leagueRegistrations.teamId, [match.teamAId, match.teamBId].sort()));
    // Match -> actor/league/membership -> teams -> registrations -> players.
    // Never acquire a tournament lock after team rows: registration writers use
    // tournament -> team -> registration. Lock existing rows, including withdrawn
    // registrations, so a status/squad change cannot race the eligibility check.
    // Missing-row legacy fallback is not a predicate lock or immutable XI proof.
    await tx.execute(sql`SELECT ${leagueRegistrations.id} FROM ${leagueRegistrations}
      WHERE ${where} ORDER BY ${leagueRegistrations.id} LIMIT 3 FOR SHARE`);
    const rows = await tx.query.leagueRegistrations.findMany({ where,
      columns: { tenantId: true, tournamentId: true, teamId: true, status: true, squadPlayerIds: true },
      orderBy: [asc(leagueRegistrations.id)], limit: 3,
    });
    let registrations: Map<string, SquadRegistration>;
    try {
      registrations = matchRegistrationMap(rows, tenantId, match.tournamentId, [match.teamAId, match.teamBId]);
    } catch {
      throw new BadRequestException('Tournament registrations require review');
    }
    for (const [id, teamId] of participants) {
      if (!registrationAllowsPlayer(registrations.get(teamId), id)) {
        throw new BadRequestException('Player is outside the approved tournament squad');
      }
    }
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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { matches, tenants, tournaments } from '@mtk/database';
import { isMatchPublished, isTournamentPublished } from '@mtk/database/lib/publication-policy';
import type { ScoringTransaction } from './scoring-write-access';
import { z } from 'zod';

export function validatePublicReadIds(...ids: string[]) {
  if (ids.some(id => !z.string().uuid().safeParse(id).success)) throw new BadRequestException('Invalid public scoring resource ID');
}

/** Run in the same read snapshot as the state/history query, never after a cache hit. */
export async function requirePublishedScoringMatch(tx: ScoringTransaction, tenantId: string, matchId: string) {
  validatePublicReadIds(tenantId, matchId);
  const match = await tx.query.matches.findFirst({ where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)) });
  if (!match || match.id !== matchId || match.tenantId !== tenantId || !isMatchPublished(match.status) || match.tournamentId === undefined) {
    throw new NotFoundException('Match not found');
  }
  const tenant = await tx.query.tenants.findFirst({ where: and(eq(tenants.id, tenantId), eq(tenants.isActive, true)), columns: { id: true, isActive: true } });
  if (!tenant || tenant.id !== tenantId || tenant.isActive !== true) throw new NotFoundException('Match not found');
  if (match.tournamentId) {
    const parent = await tx.query.tournaments.findFirst({ where: and(eq(tournaments.id, match.tournamentId), eq(tournaments.tenantId, tenantId)), columns: { id: true, tenantId: true, status: true } });
    if (!parent || parent.id !== match.tournamentId || parent.tenantId !== tenantId || !isTournamentPublished(parent.status)) throw new NotFoundException('Match not found');
  }
  return match;
}

export function publicMatchRoom(tenantId: string, matchId: string) { return `public-match:${tenantId}:${matchId}`; }

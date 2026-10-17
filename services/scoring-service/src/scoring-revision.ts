import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { matches, auditLogs } from '@mtk/database';
import { SCORING_CONFLICT_MESSAGE, scoringRevisionDecision } from '@mtk/database/lib/scoring-revision';
import { randomUUID } from 'crypto';
import type { ScoringTransaction } from './scoring-write-access';

type MatchRevision = { id: string; tenantId: string; scoringRevision?: number | null };
export function requireScoringRevision(match: MatchRevision, expected?: number | null) {
  const decision = scoringRevisionDecision(expected, match.scoringRevision);
  if (decision.status === 'conflict') throw new ConflictException({
    code: 'SCORING_REVISION_CONFLICT', message: decision.reason, currentRevision: decision.current,
  });
  return decision;
}

/** Caller already owns match -> actor/membership locks; no new lock ordering. */
export async function commitScoringRevision(tx: ScoringTransaction, match: MatchRevision,
  actorId: string, expected: number | null | undefined, operation: string,
  details: Record<string, unknown> = {}) {
  const revision = requireScoringRevision(match, expected);
  const [updated] = await tx.update(matches).set({ scoringRevision: revision.next, updatedAt: new Date() })
    .where(and(eq(matches.id, match.id), eq(matches.tenantId, match.tenantId),
      eq(matches.scoringRevision, revision.current))).returning({ scoringRevision: matches.scoringRevision });
  if (updated?.scoringRevision !== revision.next) throw new ConflictException({
    code: 'SCORING_REVISION_CONFLICT', message: SCORING_CONFLICT_MESSAGE,
    currentRevision: revision.current,
  });
  await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId: match.tenantId, actorId,
    method: 'SCORING_REVISION', path: `/scoring/match/${match.id}`, statusCode: '200',
    payload: { ...details, matchId: match.id, operation, beforeRevision: revision.current, afterRevision: revision.next },
  });
  return revision.next;
}

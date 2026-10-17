import { ConflictException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { matches, auditLogs } from '@mtk/database';
import { commitScoringRevision } from './scoring-revision';
import type { ScoringTransaction } from './scoring-write-access';

jest.mock('@mtk/database/client', () => ({ db: {}, queryClient: {}, migrationClient: {} }));

const match = { id: 'match', tenantId: 'league', scoringRevision: 4 };
function fixture(rows = [{ scoringRevision: 5 }]) {
  const values = jest.fn().mockResolvedValue(undefined);
  const returning = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const tx = { update: jest.fn().mockReturnValue({ set }), insert: jest.fn().mockReturnValue({ values }) };
  return { tx, set, where, values };
}

describe('Scoped durable revision compare-and-set (SQL construction, not database acceptance)', () => {
  it('predicates the increment on match, league and observed revision with authoritative audit fields', async () => {
    const { tx, set, where, values } = fixture();
    expect(await commitScoringRevision(tx as unknown as ScoringTransaction, match, 'actor', 4, 'record_ball',
      { matchId: 'forged', operation: 'forged', afterRevision: 900 })).toBe(5);
    expect(tx.update).toHaveBeenCalledWith(matches);
    expect(set.mock.calls[0][0].scoringRevision).toBe(5);
    const predicate = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(predicate.params).toEqual(['match', 'league', 4]);
    expect(predicate.sql).toContain('"matches"."scoring_revision"');
    expect(tx.insert).toHaveBeenCalledWith(auditLogs);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor', tenantId: 'league',
      payload: { matchId: 'match', operation: 'record_ball', beforeRevision: 4, afterRevision: 5 } }));
  });
  it('fails closed and emits no success audit if the CAS returns no row', async () => {
    const { tx, values } = fixture([]);
    await expect(commitScoringRevision(tx as unknown as ScoringTransaction, match, 'actor', 4, 'record_ball'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(values).not.toHaveBeenCalled();
  });
  it('does not issue SQL for a missing token after the first revision', async () => {
    const { tx } = fixture();
    await expect(commitScoringRevision(tx as unknown as ScoringTransaction, match, 'actor', undefined, 'record_ball'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

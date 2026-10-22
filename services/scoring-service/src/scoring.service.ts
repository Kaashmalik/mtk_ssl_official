import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@mtk/database';
import {
  matchBalls,
  matchInnings,
  matches,
  NewMatchBall,
  scoringEvents,
  scorecardProjections,
  players,
  teams,
  tournaments,
  venues,
  isUniqueViolation,
  auditLogs,
} from '@mtk/database';
import Redis from 'ioredis';
import { calculateDeliveryDelta } from '@mtk/database/lib/scoring-delivery';
import { foldScoringParticipants, type ParticipantBallInput, type ScoringParticipants } from '@mtk/database/lib/scoring-participants';
import { assessInningsClosure } from './cricket-rules';
import { deliveryCommandSchema, deliveryFingerprint } from './delivery-command';
import { z } from 'zod';
import { env } from './env';
import { requireScoringWriteAccess, requireDeliveryParticipants, requireMatchTeams } from './scoring-write-access';
import type { ScoringTransaction } from './scoring-write-access';
import { BALL_TOPIC, MATCH_TOPIC, enqueueScoringMessage } from './scoring-outbox';
import { requirePublishedScoringMatch, validatePublicReadIds } from './scoring-public-access';
import { requireScoringRevision, commitScoringRevision } from './scoring-revision';
import type { DeliveryCommand } from './delivery-command';
import {
  ScoringBallEventPayload,
} from './kafka-scoring-publisher.service';
import {
  parseCachedMatchState,
  buildMatchState,
  type MatchState,
  type MatchStatus,
  type Scorecard,
} from './match-state';

// Re-exported so existing importers of these shapes from this module keep
// working; `match-state.ts` is the single definition.
export type { MatchState, MatchStatus, Scorecard };

export interface BallEvent {
  handoverEpoch?: number;
  expectedRevision?: number;
  review?: DeliveryCommand['review'];
  clientOpId: string;
  matchId: string;
  inningsId: string;
  over: number;
  ball: number;
  runs: number;
  extras?: {
    type: 'wide' | 'noball' | 'bye' | 'legbye';
    runs: number;
  };
  wicket?: {
    type: string;
    playerId: string;
    fielderId?: string;
  };
  batsmanId: string;
  bowlerId: string;
  timestamp: Date;
}


export interface BallResult {
  scoringRevision: number;
  ballId: string;
  clientOpId?: string;
  scorecard: Scorecard;
  replayed?: boolean;
  /** Batch 100: canonical striker/non-striker/bowler projection folded from
   *  the official delivery log inside the same transaction. `null` unless
   *  SCORING_PARTICIPANTS_READY is enabled in this environment. */
  participants?: ScoringParticipants | null;
}

const recordedDeltaSchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  batterRuns: z.number().int().nonnegative(),
  extras: z.number().int().nonnegative(),
  legalBalls: z.number().int().min(0).max(1),
  wides: z.number().int().min(0).max(7),
  noBalls: z.number().int().min(0).max(7),
  byes: z.number().int().nonnegative(),
  legByes: z.number().int().nonnegative(),
  isFour: z.boolean(),
  isSix: z.boolean(),
});

function scorecardFor(innings: {
  matchId: string; inningsNumber: number; totalRuns: number;
  totalWickets: number; totalBalls: number;
}): Scorecard {
  return {
    matchId: innings.matchId,
    innings: innings.inningsNumber,
    totalRuns: innings.totalRuns,
    totalWickets: innings.totalWickets,
    overs: Math.floor(innings.totalBalls / 6),
    balls: innings.totalBalls % 6,
    runRate: innings.totalBalls > 0
      ? Number((innings.totalRuns / (innings.totalBalls / 6)).toFixed(2)) : 0,
  };
}

export interface CreateInningsInput {
  matchId: string;
  teamId: string;
  inningsNumber: number;
  /** SCORE-11 writer fencing: the handover epoch the scoring session observed. */
  handoverEpoch?: number;
  expectedRevision?: number;
}

export interface InningsSummary {
  scoringRevision?: number;
  id: string;
  matchId: string;
  teamId: string;
  inningsNumber: number;
  status: 'not_started' | 'in_progress' | 'completed';
}

export interface CompleteInningsResult {
  scoringRevision: number;
  innings: InningsSummary;
  /** Parent match status after the completion. */
  matchStatus: MatchStatus;
  /** True when we applied the `live` -> `innings_break` transition. */
  inningsBreakApplied: boolean;
}


/**
 * Row shapes that carry a `tenantId`, used for the ownership assertion below.
 */
interface TenantScoped {
  tenantId: string;
}

/**
 * Module-level logger so the tenant-scope helper can report rejections without
 * every method signature having to thread a logger through.
 */
const tenantScopeLogger = new Logger('ScoringService.TenantScope');

/**
 * Fails closed when a resolved row does not belong to the calling tenant.
 *
 * This is the enforcement point for tenant isolation. Because this service holds
 * `service_role` (which bypasses RLS), a bare `WHERE id = $1` would happily
 * return or mutate another tenant's row. Callers pass the tenant the web app
 * derived from the Clerk session; this compares it against the row that was
 * actually found.
 *
 * `NotFoundException` rather than `ForbiddenException` is deliberate: returning
 * 404 instead of 403 avoids confirming that the id exists in some *other*
 * tenant, which would itself leak cross-tenant information.
 */
function assertTenantScope(
  tenantId: string,
  entity: TenantScoped | undefined,
  label: string,
  id: string,
): void {
  if (!entity) {
    throw new NotFoundException(`${label} ${id} not found`);
  }
  if (entity.tenantId !== tenantId) {
    tenantScopeLogger.warn(
      `Blocked cross-tenant ${label.toLowerCase()} access: id=${id} ` +
        `requestedTenant=${tenantId} owningTenant=${entity.tenantId}`,
    );
    throw new NotFoundException(`${label} ${id} not found`);
  }
}

function validateMutationIds(...ids: string[]) {
  if (ids.some((id) => !z.string().uuid().safeParse(id).success)) {
    throw new BadRequestException('Invalid scoring resource ID');
  }
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private readonly redis: Redis;

  constructor() {
    const redisUrl = new URL(env.REDIS_URL);
    this.redis = new Redis({
      host: env.REDIS_HOST ?? redisUrl.hostname,
      port: env.REDIS_PORT ?? Number(redisUrl.port || "6379"),
      maxRetriesPerRequest: null,
    });
  }

  /** Internal cached read only. Network reads must use getPublicMatchState. */
  async getMatchState(matchId: string, fresh = false): Promise<MatchState | null> {
    if (!z.string().uuid().safeParse(matchId).success) throw new BadRequestException('Invalid match ID');
    const cacheKey = `match:state:${matchId}`;
    try {
      const cached = fresh ? null : await this.redis.get(cacheKey);
      if (cached) {
        const parsed = parseCachedMatchState(cached);
        if (parsed && parsed.matchId === matchId) {
          this.logger.debug(`Cache hit for match state: ${matchId}`);
          return parsed;
        }
        // Corrupt or unrecognised payload: drop it and fall through to the DB
        // rather than broadcasting a half-formed state.
        this.logger.warn(`Discarding invalid cached match state for ${matchId}`);
        await this.redis.del(cacheKey).catch((delErr) =>
          this.logger.warn(`Failed to drop invalid cache entry: ${delErr}`),
        );
      }
    } catch (cacheErr) {
      this.logger.warn(`Failed to read match state from Redis cache: ${cacheErr}`);
    }

    try {
      // One consistent read snapshot; no match/innings mixture across commits.
      const state = await db.transaction(async (tx) => {
        const match = await tx.query.matches.findFirst({
          where: eq(matches.id, matchId),
        });
        if (!match) throw new NotFoundException(`Match ${matchId} not found`);

        const innings = await tx.query.matchInnings.findMany({
          where: and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, match.tenantId)),
          orderBy: [matchInnings.inningsNumber],
        });
        return buildMatchState(match, innings);
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });

      try {
        // Fresh joins/broadcasts never publish or populate a potentially stale cache.
        if (!fresh) await this.redis.set(cacheKey, JSON.stringify(state), 'EX', 5);
      } catch (cacheErr) {
        this.logger.warn(`Failed to write match state to Redis cache: ${cacheErr}`);
      }

      return state;
    } catch (error) {
      this.logger.error(`Failed to get match state for ${matchId}:`, error);
      throw error;
    }
  }

  /**
   * Batch 100: fold the canonical participant projection from this innings'
   * official delivery log, INSIDE the caller's transaction - so the response
   * always reflects exactly the rows this transaction settled (record or
   * undo). Callers gate on SCORING_PARTICIPANTS_READY because the fold reads
   * the `wicket_player_out_id` column created by migration 20261022120000.
   */
  private async foldParticipantsForInnings(
    tx: ScoringTransaction,
    tenantId: string,
    inningsId: string,
  ): Promise<ScoringParticipants> {
    const rows = await tx
      .select({
        ballSequence: matchBalls.ballSequence,
        overNumber: matchBalls.overNumber,
        ballNumber: matchBalls.ballNumber,
        batsmanId: matchBalls.batsmanId,
        bowlerId: matchBalls.bowlerId,
        runs: matchBalls.runs,
        isWide: matchBalls.isWide,
        isNoBall: matchBalls.isNoBall,
        isBye: matchBalls.isBye,
        isLegBye: matchBalls.isLegBye,
        isWicket: matchBalls.isWicket,
        wicketType: matchBalls.wicketType,
        wicketPlayerOutId: matchBalls.wicketPlayerOutId,
      })
      .from(matchBalls)
      .where(and(eq(matchBalls.inningsId, inningsId), eq(matchBalls.tenantId, tenantId)))
      .orderBy(asc(matchBalls.ballSequence));
    return foldScoringParticipants(rows);
  }

  async recordBall(tenantId: string, actorId: string, ballEvent: BallEvent): Promise<BallResult> {
    const validated = deliveryCommandSchema.safeParse(ballEvent);
    if (!validated.success) {
      throw new BadRequestException(validated.error.issues.map((issue) => issue.message));
    }
    const command = validated.data;
    const fingerprint = deliveryFingerprint(command);
    let delta: ReturnType<typeof calculateDeliveryDelta>;
    try {
      delta = calculateDeliveryDelta({
        runs: command.runs,
        extras: command.extras ? { type: command.extras.type, runs: command.extras.runs } : undefined,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid delivery runs');
    }
    const { matchId, inningsId } = ballEvent;
    // Batch 100: the attribution columns (migration 20261022120000) exist
    // only where the migration has been applied; the flag guarantees the
    // insert and the fold never reference them before that.
    const participantsEnabled = env.SCORING_PARTICIPANTS_READY === 'true';

    const outcome = await db.transaction(async (tx) => {
      // Serialize commands for this match, including retries and undo. Locks
      // are transaction-scoped and tenant-filtered; no process-local mutex.
      await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
        WHERE ${matches.id} = ${matchId} AND ${matches.tenantId} = ${tenantId} FOR UPDATE`);
      // 1. Validate match exists, belongs to this tenant, and is in a scorable
      //    state. Scoping the WHERE clause (not just comparing afterwards) means
      //    a cross-tenant id never even reaches the comparison.
      const match = await tx.query.matches.findFirst({
        where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
      });

      assertTenantScope(tenantId, match, 'Match', matchId);

      await requireScoringWriteAccess(tx, tenantId, actorId, match, command.handoverEpoch);
      // 2. Validate innings exists within this tenant and this match
      const innings = await tx.query.matchInnings.findFirst({
        where: and(
          eq(matchInnings.id, inningsId),
          eq(matchInnings.matchId, matchId),
          eq(matchInnings.tenantId, tenantId)
        ),
      });

      assertTenantScope(tenantId, innings, 'Innings', inningsId);

      // The immutable event remembers a command even after its ball is undone.
      // A retry cannot silently recreate an undone ball or reuse an op ID for
      // different contents. Replay before lifecycle/coordinate checks so an
      // already-accepted command can still be acknowledged after innings end.
      if (command.clientOpId) {
        const recorded = await tx.query.scoringEvents.findFirst({
          where: and(
            eq(scoringEvents.matchId, matchId), eq(scoringEvents.tenantId, tenantId),
            eq(scoringEvents.eventType, 'ball_recorded'),
            sql`${scoringEvents.payload}->>'client_op_id' = ${command.clientOpId}`,
          ),
        });
        if (recorded) {
          const payload = recorded.payload as Record<string, unknown>;
          if (recorded.inningsId !== inningsId || payload.fingerprint !== fingerprint) {
            throw new ConflictException('Operation ID already belongs to a different delivery');
          }
          const recordedBallId = z.string().uuid().safeParse(payload.ball_id);
          if (!recordedBallId.success) throw new ConflictException('Stored operation requires score review');
          const existing = await tx.query.matchBalls.findFirst({
            where: and(eq(matchBalls.id, recordedBallId.data), eq(matchBalls.tenantId, tenantId),
              eq(matchBalls.matchId, matchId), eq(matchBalls.inningsId, inningsId)),
          });
          if (!existing) throw new ConflictException('This delivery was undone; use a new operation ID');
          return { result: { ballId: existing.id, clientOpId: command.clientOpId,
            scoringRevision: match.scoringRevision ?? 0,
            scorecard: scorecardFor(innings), replayed: true }, recorded: false };
        }
      }

      requireScoringRevision(match, command.expectedRevision);
      if (!['scheduled', 'toss', 'live', 'innings_break'].includes(match.status)) {
        throw new BadRequestException(`Match ${matchId} cannot be scored while ${match.status}`);
      }
      if (innings.status === 'completed') throw new BadRequestException('Innings is already completed');

      const expectedOver = Math.floor(innings.totalBalls / 6);
      const expectedBall = (innings.totalBalls % 6) + 1;
      if (command.over !== expectedOver || command.ball !== expectedBall) {
        throw new ConflictException({ code: 'SCORING_REVISION_CONFLICT', currentRevision: match.scoringRevision ?? 0,
          message: `Expected delivery ${expectedOver}.${expectedBall}; refresh match state. Saved delivery coordinates cannot be silently changed.` });
      }
      const battingXICount = await requireDeliveryParticipants(tx, tenantId, match, innings.teamId, command);

      // 4. Determine ball properties from event
      const isWide = ballEvent.extras?.type === 'wide';
      const isNoBall = ballEvent.extras?.type === 'noball';
      const isBye = ballEvent.extras?.type === 'bye';
      const isLegBye = ballEvent.extras?.type === 'legbye';
      const isWicket = !!ballEvent.wicket && ballEvent.wicket.type !== 'retired_hurt';
      const { totalRuns, isFour, isSix } = delta;

      // Initialize scorecard projection if missing
      const projection = await tx.query.scorecardProjections.findFirst({
        where: eq(scorecardProjections.inningsId, inningsId),
      });

      if (!projection) {
        await tx.insert(scorecardProjections).values({
          tenantId: match.tenantId,
          matchId: matchId,
          inningsId: inningsId,
          inningsNumber: innings.inningsNumber,
          teamId: innings.teamId,
          totalRuns: 0,
          totalWickets: 0,
          totalBalls: 0,
          totalExtras: 0,
          wides: 0,
          noBalls: 0,
          byes: 0,
          legByes: 0,
          currentOver: 0,
          currentBall: 0,
          lastEventSequence: 0,
        });
      }

      // The match lock protects MAX+1 event and delivery sequence allocation.
      const lastEvent = await tx.select({ seq: sql<number>`COALESCE(MAX(sequence_number), 0)` })
        .from(scoringEvents)
        .where(eq(scoringEvents.aggregateId, inningsId));
      const nextSeq = Number(lastEvent[0]?.seq || 0) + 1;
      const lastDelivery = await tx.query.matchBalls.findFirst({
        where: and(eq(matchBalls.matchId, matchId), eq(matchBalls.inningsId, inningsId),
          eq(matchBalls.tenantId, tenantId)),
        orderBy: [desc(matchBalls.ballSequence)],
      });

      // 5. Insert the ball record
      const ballInsert: NewMatchBall = {
        tenantId: match.tenantId,
        matchId,
        inningsId,
        ballSequence: (lastDelivery?.ballSequence ?? 0) + 1,
        clientOpId: command.clientOpId ?? null,
        overNumber: ballEvent.over,
        ballNumber: ballEvent.ball,
        bowlerId: ballEvent.bowlerId || null,
        batsmanId: ballEvent.batsmanId || null,
        // match_balls.runs is the total displayed by public timelines/scorecards.
        runs: totalRuns,
        isWicket,
        wicketType: command.wicket?.type ?? null,
        ...(participantsEnabled
          ? {
              // Batch 100: persist exactly the attribution the scorer
              // declared (already validated against the batting XI by
              // requireScoringWriteAccess). No silent stripping.
              wicketPlayerOutId: command.wicket?.playerId ?? null,
              wicketFielderId: command.wicket?.fielderId ?? null,
            }
          : {}),
        isFour,
        isSix,
        isWide,
        isNoBall,
        isBye,
        isLegBye,
        shotDirection: null,
        shotType: null,
      };

      const [insertedBall] = await tx.insert(matchBalls)
        .values(ballInsert)
        .returning();

      if (!insertedBall) throw new InternalServerErrorException('Ball insert returned no row');
      const [recordedEvent] = await tx.insert(scoringEvents).values({
        tenantId, matchId, inningsId, eventType: 'ball_recorded', eventVersion: 2,
        aggregateId: inningsId, sequenceNumber: nextSeq,
        metadata: { actor_user_id: actorId, actor_tenant_id: tenantId },
        payload: {
          ball_id: insertedBall.id, client_op_id: command.clientOpId ?? null, fingerprint,
          delta, runs: totalRuns, batsman_runs: delta.batterRuns,
          is_wicket: isWicket, is_wide: isWide, is_no_ball: isNoBall,
          is_bye: isBye, is_leg_bye: isLegBye,
        },
      }).returning({ id: scoringEvents.id, sequenceNumber: scoringEvents.sequenceNumber });

      // 6. Incrementally update innings aggregates (O(1) - no recalculation)
      await tx.update(matchInnings)
        .set({
          totalRuns: sql`${matchInnings.totalRuns} + ${totalRuns}`,
          totalWickets: sql`${matchInnings.totalWickets} + ${isWicket ? 1 : 0}`,
          totalBalls: sql`${matchInnings.totalBalls} + ${delta.legalBalls}`,
          extras: sql`${matchInnings.extras} + ${delta.extras}`,
          byes: sql`${matchInnings.byes} + ${delta.byes}`,
          legByes: sql`${matchInnings.legByes} + ${delta.legByes}`,
          wides: sql`${matchInnings.wides} + ${delta.wides}`,
          noBalls: sql`${matchInnings.noBalls} + ${delta.noBalls}`,
          status: 'in_progress',
          updatedAt: new Date(),
        })
        .where(and(eq(matchInnings.id, inningsId), eq(matchInnings.tenantId, tenantId)));

      // 7. Update match status to live if not already
      if (match.status === 'scheduled' || match.status === 'toss' || match.status === 'innings_break') {
        await tx.update(matches)
          .set({
            status: 'live',
            startDate: match.startDate ?? new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)));
      }

      // Capture only the initial scheduled/toss -> live transition, not innings
      // resumption or every subsequent ball.
      const becameLive = match.status === 'scheduled' || match.status === 'toss';

      // 8. Fetch updated innings for the response scorecard
      const updatedInnings = await tx.query.matchInnings.findFirst({
        where: and(eq(matchInnings.id, inningsId), eq(matchInnings.tenantId, tenantId)),
      });

      if (!updatedInnings) {
        throw new Error('Innings disappeared during transaction');
      }

      const scorecard = scorecardFor(updatedInnings);
      // SCORE-10 (Batch 154): the innings-closure decision is computed from
      // the just-updated row inside the same transaction (never a stale
      // read). A second-innings target derives from the first innings
      // total, read here only when it can matter.
      const firstInnings = updatedInnings.inningsNumber >= 2
        ? await tx.query.matchInnings.findFirst({
            where: and(
              eq(matchInnings.matchId, matchId),
              eq(matchInnings.tenantId, tenantId),
              eq(matchInnings.inningsNumber, 1),
            ),
          })
        : null;
      const inningsClosure = assessInningsClosure({
        inningsNumber: updatedInnings.inningsNumber,
        totalRuns: updatedInnings.totalRuns,
        totalWickets: updatedInnings.totalWickets,
        legalBalls: updatedInnings.totalBalls,
        matchTotalOvers: match.totalOvers ?? null,
        firstInningsTotalRuns: firstInnings?.totalRuns ?? null,
        battingXICount,
      });
      // Reconcile the existing trigger-owned projection with the exact innings
      // delta in this transaction (older triggers omit extras during undo).
      await tx.update(scorecardProjections).set({
        totalRuns: updatedInnings.totalRuns, totalWickets: updatedInnings.totalWickets,
        totalBalls: updatedInnings.totalBalls, totalExtras: updatedInnings.extras,
        wides: updatedInnings.wides, noBalls: updatedInnings.noBalls,
        byes: updatedInnings.byes, legByes: updatedInnings.legByes,
        currentOver: scorecard.overs, currentBall: scorecard.balls,
        lastEventSequence: nextSeq, updatedAt: new Date(),
      }).where(and(eq(scorecardProjections.inningsId, inningsId),
        eq(scorecardProjections.tenantId, tenantId)));

      this.logger.log(
        `Ball ${ballEvent.over}.${ballEvent.ball}: ${totalRuns} runs${isWicket ? ' + WICKET' : ''} ` +
        `| Score: ${scorecard.totalRuns}/${scorecard.totalWickets} (${scorecard.overs}.${scorecard.balls})`
      );

      const result = {
        ballId: insertedBall.id,
        clientOpId: command.clientOpId,
        scorecard,
        // Batch 100: the striker/non-striker/bowler projection folded from
        // this innings' settled delivery log, in this same transaction.
        participants: participantsEnabled
          ? await this.foldParticipantsForInnings(tx, tenantId, inningsId)
          : null,
        // SCORE-10 (Batch 154): state-decided innings closure, decided in
        // the same transaction that recorded the ball.
        rules: { inningsClosure },
        scoringRevision: await commitScoringRevision(tx, match, actorId, command.expectedRevision, 'record_ball', {
          clientOpId: command.clientOpId, ballId: insertedBall.id,
          ...(command.review ? { clientReportedReview: command.review } : {}),
        }),
      };

      // Resolve player names for downstream consumers (commentary fallback,
      // notifications). Tenant-scoped: a player id arriving in the payload must
      // not be able to surface another tenant's player name in a broadcast.
      const [batsmanPlayer, bowlerPlayer] = await Promise.all([
        ballEvent.batsmanId
          ? tx.query.players.findFirst({
              where: and(
                eq(players.id, ballEvent.batsmanId),
                eq(players.tenantId, tenantId),
              ),
            })
          : Promise.resolve(null),
        ballEvent.bowlerId
          ? tx.query.players.findFirst({
              where: and(
                eq(players.id, ballEvent.bowlerId),
                eq(players.tenantId, tenantId),
              ),
            })
          : Promise.resolve(null),
      ]);

      if (!recordedEvent) {
        throw new Error('Failed to persist scoring event');
      }

      const publishData: ScoringBallEventPayload = {
        type: isWicket ? 'WICKET' : isSix ? 'SIX_HIT' : isFour ? 'FOUR_HIT' : 'BALL_RECORDED',
        data: {
          tenantId: match.tenantId,
          matchId,
          inningsId,
          runs: totalRuns,
          batsmanName: batsmanPlayer?.name ?? '',
          bowlerName: bowlerPlayer?.name ?? '',
          over: ballEvent.over,
          ball: ballEvent.ball,
        },
        eventId: recordedEvent.id,
        matchId,
        tenantId: match.tenantId,
        inning: updatedInnings.inningsNumber,
        over: ballEvent.over,
        ball: ballEvent.ball,
        runs: totalRuns,
        extras: ballEvent.extras
          ? { type: ballEvent.extras.type, runs: ballEvent.extras.runs }
          : undefined,
        wicket: ballEvent.wicket
          ? {
              type: ballEvent.wicket.type,
              playerOut: ballEvent.wicket.playerId,
              dismissedBy: ballEvent.wicket.fielderId,
            }
          : undefined,
        batsmanId: ballEvent.batsmanId,
        bowlerId: ballEvent.bowlerId,
        batsmanName: batsmanPlayer?.name,
        bowlerName: bowlerPlayer?.name,
        sequenceNumber: recordedEvent.sequenceNumber,
        timestamp: new Date().toISOString(),
      };

      // Persist the intro ahead of the first ball in the same match stream.
      // Both rows roll back with the delivery if any database operation fails.
      if (becameLive) await this.enqueueMatchStarted(tx, match);
      await enqueueScoringMessage(tx, { topic: BALL_TOPIC, payload: publishData });
      return { result, recorded: true };
    }, { isolationLevel: 'read committed' });

    if (!outcome.recorded) return outcome.result;
    const { result } = outcome;
    await this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(`Failed to invalidate match state cache: ${err}`));

    // Kafka delivery is owned by the durable worker, never this HTTP response.
    return result;
  }

  async undoBall(tenantId: string, actorId: string, matchId: string, ballId: string,
    fence?: number | null, expectedRevision?: number | null): Promise<BallResult> {
    validateMutationIds(matchId, ballId);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
        WHERE ${matches.id} = ${matchId} AND ${matches.tenantId} = ${tenantId} FOR UPDATE`);
      const match = await tx.query.matches.findFirst({
        where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
      });
      assertTenantScope(tenantId, match, 'Match', matchId);
      await requireScoringWriteAccess(tx, tenantId, actorId, match, fence);
      // A response lost after commit must not turn an accepted undo into an
      // unrecoverable revision conflict. The immutable undo event is its key.
      const undone = await tx.query.scoringEvents.findFirst({ where: and(
        eq(scoringEvents.tenantId, tenantId), eq(scoringEvents.matchId, matchId),
        eq(scoringEvents.eventType, 'ball_undone'), sql`${scoringEvents.payload}->>'ball_id' = ${ballId}`,
      ) });
      if (undone) {
        const innings = await tx.query.matchInnings.findFirst({ where: and(
          eq(matchInnings.id, undone.inningsId), eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId),
        ) });
        assertTenantScope(tenantId, innings, 'Innings', undone.inningsId);
        return { ballId, scorecard: scorecardFor(innings), scoringRevision: match.scoringRevision ?? 0, replayed: true };
      }
      requireScoringRevision(match, expectedRevision);
      if (!['scheduled', 'toss', 'live', 'innings_break'].includes(match.status)) {
        throw new BadRequestException('This match can no longer be edited');
      }
      // 1. Find the ball to undo, scoped to this tenant
      const ball = await tx.query.matchBalls.findFirst({
        where: and(
          eq(matchBalls.id, ballId),
          eq(matchBalls.matchId, matchId),
          eq(matchBalls.tenantId, tenantId)
        ),
      });

      assertTenantScope(tenantId, ball, 'Ball', ballId);

      // Verify that this is the last recorded ball in this innings to prevent cascading database drift
      const lastRecordedBall = await tx.query.matchBalls.findFirst({
        where: and(
          eq(matchBalls.inningsId, ball.inningsId),
          eq(matchBalls.tenantId, tenantId),
        ),
        orderBy: [desc(matchBalls.ballSequence)],
      });

      if (!lastRecordedBall || lastRecordedBall.id !== ballId) {
        throw new BadRequestException('Only the last recorded ball can be undone');
      }

      // Verify that it is within a 5-minute safety time window
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (ball.createdAt < fiveMinutesAgo) {
        throw new BadRequestException('Cannot undo a ball recorded more than 5 minutes ago');
      }

      // 2. Get the innings this ball belongs to
      const innings = await tx.query.matchInnings.findFirst({
        where: and(
          eq(matchInnings.id, ball.inningsId),
          eq(matchInnings.tenantId, tenantId),
        ),
      });

      assertTenantScope(tenantId, innings, 'Innings', ball.inningsId);

      if (innings.status === 'completed') {
        throw new BadRequestException('Cannot undo balls in a completed innings');
      }

      // Exact v2 event deltas survive independently of the mutable ball row.
      // Legacy extras did not retain enough information to reverse safely.
      const recorded = await tx.query.scoringEvents.findFirst({
        where: and(eq(scoringEvents.tenantId, tenantId), eq(scoringEvents.matchId, matchId),
          eq(scoringEvents.inningsId, ball.inningsId), eq(scoringEvents.eventType, 'ball_recorded'),
          sql`${scoringEvents.payload}->>'ball_id' = ${ballId}`),
      });
      const payload = recorded?.payload as Record<string, unknown> | undefined;
      let delta: ReturnType<typeof calculateDeliveryDelta>;
      if (recorded) {
        const decoded = recordedDeltaSchema.safeParse(payload?.delta);
        if (recorded.eventVersion !== 2 || !decoded.success) {
          throw new ConflictException('Stored delivery accounting requires review before undo');
        }
        delta = {
          totalRuns: decoded.data.totalRuns, batterRuns: decoded.data.batterRuns,
          extras: decoded.data.extras, legalBalls: decoded.data.legalBalls,
          wides: decoded.data.wides, noBalls: decoded.data.noBalls,
          byes: decoded.data.byes, legByes: decoded.data.legByes,
          isFour: decoded.data.isFour, isSix: decoded.data.isSix,
        };
        if (delta.totalRuns !== ball.runs || delta.totalRuns !== delta.batterRuns + delta.extras) {
          throw new ConflictException('Stored delivery accounting does not match the ball');
        }
        try {
          const extrasType = ball.isWide ? 'wide' : ball.isNoBall ? 'noball'
            : ball.isBye ? 'bye' : ball.isLegBye ? 'legbye' : undefined;
          const expected = calculateDeliveryDelta({ runs: delta.batterRuns,
            extras: extrasType ? { type: extrasType, runs: delta.extras } : undefined });
          if (Object.entries(expected).some(([key, value]) => delta[key] !== value) ||
              payload?.is_wicket !== ball.isWicket) {
            throw new Error('Delta does not match delivery flags');
          }
        } catch {
          throw new ConflictException('Stored delivery components require review before undo');
        }
      } else {
        if (ball.isWide || ball.isNoBall || ball.isBye || ball.isLegBye) {
          throw new ConflictException('Legacy extras require score review; automatic undo is unsafe');
        }
        delta = calculateDeliveryDelta({ runs: ball.runs });
      }

      const isWide = ball.isWide;
      const isNoBall = ball.isNoBall;
      const isBye = ball.isBye;
      const isLegBye = ball.isLegBye;
      const isWicket = ball.isWicket;
      const totalRuns = delta.totalRuns;
      if (innings.totalRuns < totalRuns || innings.totalBalls < delta.legalBalls ||
          innings.totalWickets < (isWicket ? 1 : 0) || innings.extras < delta.extras ||
          innings.byes < delta.byes || innings.legByes < delta.legByes ||
          innings.wides < delta.wides || innings.noBalls < delta.noBalls) {
        throw new ConflictException('Innings accounting requires review before undo');
      }

      // Insert undo event into scoringEvents
      const lastEvent = await tx.select({ seq: sql<number>`COALESCE(MAX(sequence_number), 0)` })
        .from(scoringEvents)
        .where(eq(scoringEvents.aggregateId, ball.inningsId));
      const nextSeq = Number(lastEvent[0]?.seq || 0) + 1;

      await tx.insert(scoringEvents).values({
        tenantId: innings.tenantId,
        matchId: matchId,
        inningsId: ball.inningsId,
        eventType: 'ball_undone',
        eventVersion: 2,
        metadata: { actor_user_id: actorId, actor_tenant_id: tenantId },
        aggregateId: ball.inningsId,
        sequenceNumber: nextSeq,
        payload: {
          ball_id: ballId,
          recorded_event_id: recorded?.id ?? null,
          delta,
          runs: totalRuns,
          is_wicket: isWicket,
          is_wide: isWide,
          is_no_ball: isNoBall,
          is_bye: isBye,
          is_leg_bye: isLegBye,
          batsman_runs: delta.batterRuns,
        },
      });

      // 4. Delete the ball record (cascade will handle related data)
      await tx.delete(matchBalls)
        .where(and(eq(matchBalls.id, ballId), eq(matchBalls.tenantId, tenantId),
          eq(matchBalls.matchId, matchId), eq(matchBalls.inningsId, ball.inningsId)));

      // 5. Decrement innings aggregates
      await tx.update(matchInnings)
        .set({
          totalRuns: innings.totalRuns - totalRuns,
          totalWickets: innings.totalWickets - (isWicket ? 1 : 0),
          totalBalls: innings.totalBalls - delta.legalBalls,
          extras: innings.extras - delta.extras,
          byes: innings.byes - delta.byes,
          legByes: innings.legByes - delta.legByes,
          wides: innings.wides - delta.wides,
          noBalls: innings.noBalls - delta.noBalls,
          updatedAt: new Date(),
        })
        .where(and(eq(matchInnings.id, ball.inningsId), eq(matchInnings.tenantId, tenantId)));

      // 6. Fetch updated state
      const updatedInnings = await tx.query.matchInnings.findFirst({
        where: and(
          eq(matchInnings.id, ball.inningsId),
          eq(matchInnings.tenantId, tenantId),
        ),
      });

      if (!updatedInnings) {
        throw new Error('Innings disappeared during undo transaction');
      }

      const scorecard = scorecardFor(updatedInnings);
      await tx.update(scorecardProjections).set({
        totalRuns: updatedInnings.totalRuns, totalWickets: updatedInnings.totalWickets,
        totalBalls: updatedInnings.totalBalls, totalExtras: updatedInnings.extras,
        wides: updatedInnings.wides, noBalls: updatedInnings.noBalls,
        byes: updatedInnings.byes, legByes: updatedInnings.legByes,
        currentOver: scorecard.overs, currentBall: scorecard.balls,
        lastEventSequence: nextSeq, updatedAt: new Date(),
      }).where(and(eq(scorecardProjections.inningsId, ball.inningsId),
        eq(scorecardProjections.tenantId, tenantId)));

      this.logger.log(
        `UNDO ball ${ballId}: removed ${totalRuns} runs${isWicket ? ' + wicket' : ''} ` +
        `| Score: ${scorecard.totalRuns}/${scorecard.totalWickets}`
      );

      const result = {
        ballId,
        scorecard,
        // Batch 100: refold after the delivery row is gone, so a confirmed
        // striker/incoming-batter state retracts with the undo instead of
        // describing a ball the official record no longer contains.
        participants: env.SCORING_PARTICIPANTS_READY === 'true'
          ? await this.foldParticipantsForInnings(tx, tenantId, ball.inningsId)
          : null,
        scoringRevision: await commitScoringRevision(tx, match, actorId, expectedRevision, 'undo_ball', { ballId }),
      };

      return result;
    }, { isolationLevel: 'read committed' });
    await this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(`Failed to invalidate match state cache: ${err}`));
    return result;
  }

  /** Publication is revalidated on every public read; Redis cannot authorize visibility. */
  async getPublicMatchState(tenantId: string, matchId: string): Promise<MatchState> {
    validatePublicReadIds(tenantId, matchId);
    return db.transaction(async tx => {
      const match = await requirePublishedScoringMatch(tx, tenantId, matchId);
      const innings = await tx.query.matchInnings.findMany({ where: and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)), orderBy: [matchInnings.inningsNumber] });
      return buildMatchState(match, innings);
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async assertPublicMatch(tenantId: string, matchId: string): Promise<void> {
    validatePublicReadIds(tenantId, matchId);
    await db.transaction(async tx => { await requirePublishedScoringMatch(tx, tenantId, matchId); }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  /** Internal Kafka bridge discovery only, not an anonymous network route. */
  async publishedMatchTenant(matchId: string): Promise<string> {
    validatePublicReadIds(matchId);
    return db.transaction(async tx => {
      const row = await tx.query.matches.findFirst({ where: eq(matches.id, matchId), columns: { id: true, tenantId: true } });
      if (!row || row.id !== matchId) throw new NotFoundException('Match not found');
      await requirePublishedScoringMatch(tx, row.tenantId, matchId);
      return row.tenantId;
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async getBallHistory(tenantId: string, matchId: string, inningsId: string, limit: number = 50) {
    validatePublicReadIds(tenantId, matchId, inningsId);
    const bounded = z.number().int().min(1).max(100).parse(limit);
    return db.transaction(async tx => {
      await requirePublishedScoringMatch(tx, tenantId, matchId);
      const innings = await tx.query.matchInnings.findFirst({ where: and(eq(matchInnings.id, inningsId), eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)) });
      if (!innings || innings.id !== inningsId || innings.matchId !== matchId || innings.tenantId !== tenantId) throw new NotFoundException('Innings not found');
      return tx.query.matchBalls.findMany({
        columns: { id: true, matchId: true, inningsId: true, overNumber: true, ballNumber: true, ballSequence: true, runs: true,
          isWicket: true, isWide: true, isNoBall: true, isBye: true, isLegBye: true, isFour: true, isSix: true,
          batsmanId: true, bowlerId: true, wicketType: true, createdAt: true },
        where: and(eq(matchBalls.tenantId, tenantId), eq(matchBalls.matchId, matchId), eq(matchBalls.inningsId, inningsId)),
        orderBy: [desc(matchBalls.ballSequence)], limit: bounded,
      });
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  /**
   * Creates an innings for a match. Canonical write path â€” the web app proxies
   * here rather than inserting directly, so innings numbering and validation
   * have exactly one implementation.
   *
   * `inningsNumber` is 1-3 (3 = super over), matching `createInningsSchema` on
   * the web side.
   *
   * `tenantId` is the caller's declared tenant. The match is looked up *with*
   * that filter so a cross-tenant `matchId` resolves to nothing rather than to
   * another tenant's row.
   */
  async createInnings(tenantId: string, actorId: string, input: CreateInningsInput): Promise<InningsSummary> {
    const parsed = z.object({ matchId: z.string().uuid(), teamId: z.string().uuid(),
      inningsNumber: z.number().int().min(1).max(3),
      handoverEpoch: z.number().int().min(0).optional(),
      expectedRevision: z.number().int().min(0).max(2147483647).optional() }).safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid innings command');
    const { matchId, teamId, inningsNumber, handoverEpoch, expectedRevision } = parsed.data;
    let created: InningsSummary;
    try {
      created = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
          WHERE ${matches.id} = ${matchId} AND ${matches.tenantId} = ${tenantId} FOR UPDATE`);
        const match = await tx.query.matches.findFirst({
          where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
        });
        assertTenantScope(tenantId, match, 'Match', matchId);
        await requireScoringWriteAccess(tx, tenantId, actorId, match, handoverEpoch);
        if (!['scheduled', 'toss', 'live', 'innings_break'].includes(match.status)) {
          throw new BadRequestException(`Cannot add an innings while match is ${match.status}`);
        }
        if (teamId !== match.teamAId && teamId !== match.teamBId) {
          throw new BadRequestException('Team does not belong to this match');
        }
        await requireMatchTeams(tx, tenantId, match);
        const existing = await tx.query.matchInnings.findFirst({
          where: and(eq(matchInnings.matchId, matchId), eq(matchInnings.inningsNumber, inningsNumber),
            eq(matchInnings.tenantId, tenantId)),
        });
        if (existing) {
          if (existing.teamId !== teamId) throw new BadRequestException(`Innings ${inningsNumber} already exists for another team`);
          return { id: existing.id, matchId: existing.matchId, teamId: existing.teamId,
            inningsNumber: existing.inningsNumber, status: existing.status, scoringRevision: match.scoringRevision ?? 0 };
        }
        requireScoringRevision(match, expectedRevision);
        const [innings] = await tx.insert(matchInnings).values({
          tenantId, matchId, teamId, inningsNumber, status: 'not_started',
        }).returning();
        if (!innings) throw new InternalServerErrorException('Innings insert returned no row');
        return { id: innings.id, matchId: innings.matchId, teamId: innings.teamId,
          inningsNumber: innings.inningsNumber, status: innings.status,
          scoringRevision: await commitScoringRevision(tx, match, actorId, expectedRevision, 'create_innings', { inningsId: innings.id }) };
      }, { isolationLevel: 'read committed' });
    } catch (err) {
      // Constraint remains a backstop for writers outside this service.
      if (isUniqueViolation(err)) throw new BadRequestException(`Innings ${inningsNumber} already exists for match ${matchId}`);
      throw err;
    }
    await this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(`Failed to invalidate match state cache: ${err}`));
    this.logger.log(`Innings ${inningsNumber} created for match ${matchId} (team ${teamId})`);
    return created;
  }

  /**
   * Completes an innings and, when appropriate, advances the parent match to
   * the innings break.
   *
   * Both transitions live here, in one transaction, so the web action can be a
   * thin proxy without losing the `live` -> `innings_break` step.
   *
   * `matchId` is required alongside `inningsId` so the update is scoped to the
   * parent match. An unscoped `WHERE id = $inningsId` would let a caller
   * complete an innings belonging to some other match.
   *
   * Idempotent: re-completing an already-completed innings performs no update,
   * and the break transition is guarded by the match's current status.
   */
  async completeInnings(
    tenantId: string,
    actorId: string,
    matchId: string,
    inningsId: string,
    fence?: number | null,
    expectedRevision?: number | null,
  ): Promise<CompleteInningsResult> {
    validateMutationIds(matchId, inningsId);
    const result = await db.transaction(async (tx) => {
      // Same lock ordering as delivery/undo; completion cannot race a write.
      await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
        WHERE ${matches.id} = ${matchId} AND ${matches.tenantId} = ${tenantId} FOR UPDATE`);
      const match = await tx.query.matches.findFirst({
        where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
      });
      assertTenantScope(tenantId, match, 'Match', matchId);
      await requireScoringWriteAccess(tx, tenantId, actorId, match, fence);
      const innings = await tx.query.matchInnings.findFirst({
        where: and(
          eq(matchInnings.id, inningsId),
          eq(matchInnings.matchId, matchId),
          eq(matchInnings.tenantId, tenantId),
        ),
      });

      assertTenantScope(tenantId, innings, 'Innings', inningsId);

      if (innings.status === 'completed') {
        return { innings: { id: innings.id, matchId: innings.matchId, teamId: innings.teamId,
          inningsNumber: innings.inningsNumber, status: innings.status },
          matchStatus: match.status, inningsBreakApplied: false, scoringRevision: match.scoringRevision ?? 0 };
      }
      requireScoringRevision(match, expectedRevision);
      if (!['scheduled', 'toss', 'live', 'innings_break'].includes(match.status)) {
        throw new BadRequestException('This match can no longer be edited');
      }

      const [updated] = await tx
        .update(matchInnings)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(and(eq(matchInnings.id, inningsId), eq(matchInnings.tenantId, tenantId)))
        .returning();

      if (!updated) {
        throw new InternalServerErrorException(
          `Innings ${inningsId} vanished during completion`,
        );
      }

      // Only the first innings triggers the break. Completing the second
      // innings ends the match, but that requires a winner and a result string,
      // so it stays behind the explicit `completeMatch` call rather than being
      // inferred here.
      let matchStatus: MatchStatus = match.status;
      let inningsBreakApplied = false;

      if (match.status === 'live' && updated.inningsNumber === 1) {
        await tx
          .update(matches)
          .set({ status: 'innings_break', updatedAt: new Date() })
          .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)));
        matchStatus = 'innings_break';
        inningsBreakApplied = true;
      }

      return {
        innings: {
          id: updated.id,
          matchId: updated.matchId,
          teamId: updated.teamId,
          inningsNumber: updated.inningsNumber,
          status: updated.status,
        },
        matchStatus,
        inningsBreakApplied,
        scoringRevision: await commitScoringRevision(tx, match, actorId, expectedRevision, 'complete_innings', { inningsId }),
      };
    }, { isolationLevel: 'read committed' });

    // `recordBall` and `getMatchState` share the `match:state:<id>` cache key.
    // Completing an innings changes both the scorecard and the match status, so
    // the entry must be dropped after commit or readers keep seeing pre-break
    // state. Cache failure is logged, never thrown â€” the DB write already
    // succeeded and a stale cache is recoverable, whereas a 500 here would
    // report a failure that did not happen.
    this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(
        `Failed to invalidate match state cache for ${matchId}: ${err}`,
      ),
    );

    this.logger.log(
      `Innings ${inningsId} of match ${matchId} completed ` +
        `(inningsBreakApplied=${result.inningsBreakApplied}, matchStatus=${result.matchStatus})`,
    );

    return result;
  }

  async completeMatch(
    tenantId: string,
    actorId: string,
    matchId: string,
    winnerId?: string,
    result?: string,
    manOfMatchId?: string,
    fence?: number | null,
    expectedRevision?: number | null,
  ): Promise<number> {
    validateMutationIds(matchId);
    const completion = z.object({ winnerId: z.string().uuid().optional(), result: z.string().min(1).max(2000).optional(),
      manOfMatchId: z.string().uuid().optional() }).safeParse({ winnerId, result, manOfMatchId });
    if (!completion.success) throw new BadRequestException('Invalid match completion command');
    const scoringRevision = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
        WHERE ${matches.id} = ${matchId} AND ${matches.tenantId} = ${tenantId} FOR UPDATE`);
      const match = await tx.query.matches.findFirst({
        where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
      });
      assertTenantScope(tenantId, match, 'Match', matchId);
      await requireScoringWriteAccess(tx, tenantId, actorId, match, fence);
      if (winnerId && winnerId !== match.teamAId && winnerId !== match.teamBId) {
        throw new BadRequestException('Winner must be one of the match teams');
      }
      // An identical retry cannot overwrite the committed result/end timestamp.
      if (match.status === 'completed') {
        if ((winnerId || null) !== match.winnerId || (result || null) !== match.result
          || (manOfMatchId !== undefined && manOfMatchId !== match.manOfMatchId)) {
          throw new ConflictException('Completed result requires an audited correction');
        }
        return match.scoringRevision ?? 0;
      }
      requireScoringRevision(match, expectedRevision);
      if (!['scheduled', 'toss', 'live', 'innings_break'].includes(match.status)) {
        throw new BadRequestException('This match can no longer be completed');
      }
      // Omission is not a request to erase metadata set before completion.
      const awardId = manOfMatchId ?? match.manOfMatchId;
      if (awardId) {
        await tx.execute(sql`SELECT ${players.id} FROM ${players}
          WHERE ${and(eq(players.id, awardId), eq(players.tenantId, tenantId))} FOR SHARE`);
        const player = await tx.query.players.findFirst({ where: and(eq(players.id, awardId), eq(players.tenantId, tenantId)) });
        if (!player || player.id !== awardId || player.tenantId !== tenantId
          || ![match.teamAId, match.teamBId].includes(player.teamId)) {
          throw new BadRequestException('Player of the Match must belong to a match team in this league');
        }
      }
      await tx.update(matches).set({ status: 'completed', winnerId: winnerId || null,
        result: result || null, manOfMatchId: awardId, endDate: new Date(), updatedAt: new Date(),
      }).where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)));
      await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId,
        method: 'MATCH_COMPLETE', path: `/scoring/match/${matchId}/complete`, statusCode: '200',
        payload: { matchId,
          before: { status: match.status, winnerId: match.winnerId, result: match.result, manOfMatchId: match.manOfMatchId },
          after: { status: 'completed', winnerId: winnerId || null, result: result || null, manOfMatchId: awardId } },
      });
      await this.enqueueMatchEnded(tx, matchId, tenantId, winnerId, result, awardId);
      return commitScoringRevision(tx, match, actorId, expectedRevision, 'complete_match');
    }, { isolationLevel: 'read committed' });

    // Same reasoning as completeInnings: the match-state cache holds a stale
    // status otherwise.
    this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(
        `Failed to invalidate match state cache for ${matchId}: ${err}`,
      ),
    );

    this.logger.log(`Match ${matchId} marked as completed`);
    return scoringRevision;
  }

  /**
   * Snapshot only same-league display names before committing the outbox entry.
   * Plain reads do not acquire new team/tournament locks after participant locks.
   */
  private async enqueueMatchStarted(
    tx: ScoringTransaction,
    match: { id: string; tenantId: string; teamAId: string; teamBId: string; tournamentId?: string | null; venueId?: string | null },
  ): Promise<void> {
    const [teamA, teamB, venue, tournament] = await Promise.all([
      tx.query.teams.findFirst({ where: and(eq(teams.id, match.teamAId), eq(teams.tenantId, match.tenantId)) }),
      tx.query.teams.findFirst({ where: and(eq(teams.id, match.teamBId), eq(teams.tenantId, match.tenantId)) }),
      match.venueId
        ? tx.query.venues.findFirst({ where: and(eq(venues.id, match.venueId), eq(venues.tenantId, match.tenantId)) })
        : Promise.resolve(null),
      match.tournamentId
        ? tx.query.tournaments.findFirst({ where: and(eq(tournaments.id, match.tournamentId), eq(tournaments.tenantId, match.tenantId)) })
        : Promise.resolve(null),
    ]);

    await enqueueScoringMessage(tx, { topic: MATCH_TOPIC, payload: {
      type: 'MatchStarted',
      matchId: match.id,
      tenantId: match.tenantId,
      eventId: `${match.id}:MatchStarted`,
      timestamp: new Date().toISOString(),
      data: {
        teamAName: teamA?.id === match.teamAId && teamA.tenantId === match.tenantId ? teamA.name ?? 'Team A' : 'Team A',
        teamBName: teamB?.id === match.teamBId && teamB.tenantId === match.tenantId ? teamB.name ?? 'Team B' : 'Team B',
        venueName: venue && venue.id === match.venueId && venue.tenantId === match.tenantId ? venue.name : null,
        tournamentName: tournament && tournament.id === match.tournamentId && tournament.tenantId === match.tenantId ? tournament.name : null,
      },
    } });
  }

  /** Snapshot result metadata and journal the end event with the result/audit. */
  private async enqueueMatchEnded(
    tx: ScoringTransaction,
    matchId: string,
    tenantId: string,
    winnerId?: string,
    result?: string,
    awardId?: string | null,
  ): Promise<void> {
    const [winner, motm] = await Promise.all([
      winnerId ? tx.query.teams.findFirst({ where: and(eq(teams.id, winnerId), eq(teams.tenantId, tenantId)) }) : Promise.resolve(null),
      awardId ? tx.query.players.findFirst({ where: and(eq(players.id, awardId), eq(players.tenantId, tenantId)) }) : Promise.resolve(null),
    ]);

    await enqueueScoringMessage(tx, { topic: MATCH_TOPIC, payload: {
      type: 'MatchEnded',
      matchId,
      tenantId,
      eventId: `${matchId}:MatchEnded`,
      timestamp: new Date().toISOString(),
      data: {
        winnerName: winner && winner.id === winnerId && winner.tenantId === tenantId ? winner.name ?? null : null,
        result: result ?? null,
        motmName: motm && motm.id === awardId && motm.tenantId === tenantId ? motm.name ?? null : null,
      },
    } });
  }
}

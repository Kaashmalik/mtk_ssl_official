import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
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
} from '@mtk/database';
import Redis from 'ioredis';
import { calculateDeliveryDelta } from '@mtk/database/lib/scoring-delivery';
import { deliveryCommandSchema, deliveryFingerprint } from './delivery-command';
import { z } from 'zod';
import { env } from './env';
import {
  KafkaScoringPublisher,
  ScoringBallEventPayload,
} from './kafka-scoring-publisher.service';
import {
  parseCachedMatchState,
  type MatchState,
  type MatchStatus,
  type Scorecard,
} from './match-state';

// Re-exported so existing importers of these shapes from this module keep
// working; `match-state.ts` is the single definition.
export type { MatchState, MatchStatus, Scorecard };

export interface BallEvent {
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
  ballId: string;
  clientOpId?: string;
  scorecard: Scorecard;
  replayed?: boolean;
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
}

export interface InningsSummary {
  id: string;
  matchId: string;
  teamId: string;
  inningsNumber: number;
  status: 'not_started' | 'in_progress' | 'completed';
}

export interface CompleteInningsResult {
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

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private readonly redis: Redis;

  constructor(private readonly kafkaPublisher: KafkaScoringPublisher) {
    const redisUrl = new URL(env.REDIS_URL);
    this.redis = new Redis({
      host: env.REDIS_HOST ?? redisUrl.hostname,
      port: env.REDIS_PORT ?? Number(redisUrl.port || "6379"),
      maxRetriesPerRequest: null,
    });
  }

  async getMatchState(matchId: string): Promise<MatchState | null> {
    const cacheKey = `match:state:${matchId}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = parseCachedMatchState(cached);
        if (parsed) {
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
      const match = await db.query.matches.findFirst({
        where: eq(matches.id, matchId),
      });

      if (!match) {
        throw new NotFoundException(`Match ${matchId} not found`);
      }

      const innings = await db.query.matchInnings.findMany({
        where: eq(matchInnings.matchId, matchId),
        orderBy: [matchInnings.inningsNumber],
      });

      const state: MatchState = {
        matchId,
        // No cast: `MatchState.status` is derived from the same column, so this
        // is a genuine type match rather than an assertion hiding a mismatch.
        status: match.status,
        currentInnings: 1,
      };

      for (const inn of innings) {
        const scorecard: Scorecard = {
          matchId,
          innings: inn.inningsNumber,
          totalRuns: inn.totalRuns,
          totalWickets: inn.totalWickets,
          overs: Math.floor(inn.totalBalls / 6),
          balls: inn.totalBalls % 6,
          runRate: inn.totalBalls > 0 ? (inn.totalRuns / (inn.totalBalls / 6)) : 0,
        };

        if (inn.inningsNumber === 1) {
          state.innings1 = scorecard;
        } else if (inn.inningsNumber === 2) {
          state.innings2 = scorecard;
          state.currentInnings = 2;
        }

        if (inn.status === 'in_progress') {
          state.currentInnings = inn.inningsNumber;
        }
      }

      try {
        await this.redis.set(cacheKey, JSON.stringify(state), 'EX', 3600); // 1 hour TTL
      } catch (cacheErr) {
        this.logger.warn(`Failed to write match state to Redis cache: ${cacheErr}`);
      }

      return state;
    } catch (error) {
      this.logger.error(`Failed to get match state for ${matchId}:`, error);
      throw error;
    }
  }

  async recordBall(tenantId: string, ballEvent: BallEvent): Promise<BallResult> {
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
            scorecard: scorecardFor(innings), replayed: true } };
        }
      }

      if (!['scheduled', 'toss', 'live', 'innings_break'].includes(match.status)) {
        throw new BadRequestException(`Match ${matchId} cannot be scored while ${match.status}`);
      }
      if (innings.status === 'completed') throw new BadRequestException('Innings is already completed');

      const expectedOver = Math.floor(innings.totalBalls / 6);
      const expectedBall = (innings.totalBalls % 6) + 1;
      if (command.over !== expectedOver || command.ball !== expectedBall) {
        throw new ConflictException(`Expected delivery ${expectedOver}.${expectedBall}; refresh match state`);
      }

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

      // Captured so the `MatchStarted` event is emitted only on the real
      // scheduled -> live transition, not on every subsequent ball.
      const becameLive = match.status === 'scheduled';

      // 8. Fetch updated innings for the response scorecard
      const updatedInnings = await tx.query.matchInnings.findFirst({
        where: and(eq(matchInnings.id, inningsId), eq(matchInnings.tenantId, tenantId)),
      });

      if (!updatedInnings) {
        throw new Error('Innings disappeared during transaction');
      }

      const scorecard = scorecardFor(updatedInnings);
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

      return { result, publishData, becameLive, match };
    });

    if (!('publishData' in outcome)) return outcome.result;
    const { result, publishData, becameLive, match } = outcome;
    await this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(`Failed to invalidate match state cache: ${err}`));

    // Publish AFTER commit â€” a slow/failed Kafka broker must never roll back a
    // recorded ball. KafkaScoringPublisher swallows failures and logs them.
    this.kafkaPublisher.publishBallEvent(publishData).catch((err) =>
      this.logger.warn(`Failed to publish ball event after commit: ${err}`),
    );

    if (becameLive) {
      // MatchStarted. Fire-and-forget after commit: a missing intro is
      // recoverable, whereas failing the recorded ball would not be.
      this.publishMatchStarted(match).catch((err) =>
        this.logger.warn(`Failed to publish MatchStarted after commit: ${err}`),
      );
    }

    return result;
  }

  async undoBall(tenantId: string, matchId: string, ballId: string): Promise<BallResult> {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
        WHERE ${matches.id} = ${matchId} AND ${matches.tenantId} = ${tenantId} FOR UPDATE`);
      const match = await tx.query.matches.findFirst({
        where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
      });
      assertTenantScope(tenantId, match, 'Match', matchId);
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
      };

      return result;
    });
    await this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(`Failed to invalidate match state cache: ${err}`));
    return result;
  }

  async getBallHistory(matchId: string, inningsId: string, limit: number = 50) {
    return db.query.matchBalls.findMany({
      where: and(
        eq(matchBalls.matchId, matchId),
        eq(matchBalls.inningsId, inningsId)
      ),
      orderBy: [desc(matchBalls.ballSequence)],
      limit,
    });
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
  async createInnings(tenantId: string, input: CreateInningsInput): Promise<InningsSummary> {
    const { matchId, teamId, inningsNumber } = input;

    if (!Number.isInteger(inningsNumber) || inningsNumber < 1 || inningsNumber > 3) {
      throw new BadRequestException('inningsNumber must be 1, 2, or 3');
    }

    const match = await db.query.matches.findFirst({
      where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
    });

    assertTenantScope(tenantId, match, 'Match', matchId);

    if (match.status === 'completed' || match.status === 'abandoned') {
      throw new BadRequestException(
        `Cannot add an innings to match ${matchId} which is already ${match.status}`,
      );
    }

    if (teamId !== match.teamAId && teamId !== match.teamBId) {
      throw new BadRequestException('Team does not belong to this match');
    }

    const existing = await db.query.matchInnings.findFirst({
      where: and(
        eq(matchInnings.matchId, matchId),
        eq(matchInnings.inningsNumber, inningsNumber),
        eq(matchInnings.tenantId, tenantId),
      ),
    });

    if (existing) {
      throw new BadRequestException(
        `Innings ${inningsNumber} already exists for match ${matchId}`,
      );
    }

    try {
      const [innings] = await db
        .insert(matchInnings)
        .values({
          tenantId: match.tenantId,
          matchId,
          teamId,
          inningsNumber,
          status: 'not_started',
        })
        .returning();

      if (!innings) {
        throw new InternalServerErrorException('Innings insert returned no row');
      }

      this.logger.log(
        `Innings ${inningsNumber} created for match ${matchId} (team ${teamId})`,
      );

      return {
        id: innings.id,
        matchId: innings.matchId,
        teamId: innings.teamId,
        inningsNumber: innings.inningsNumber,
        status: innings.status,
      };
    } catch (err) {
      // The existence check above is TOCTOU-racy: two concurrent requests (or an
      // impatient double-click) can both pass it and then collide on the
      // `UNIQUE (match_id, innings_number)` constraint. Translate that into the
      // same client-facing error the check would have produced.
      if (isUniqueViolation(err)) {
        throw new BadRequestException(
          `Innings ${inningsNumber} already exists for match ${matchId}`,
        );
      }
      throw err;
    }
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
   * Idempotent: re-completing an already-completed innings is a no-op update,
   * and the break transition is guarded by the match's current status.
   */
  async completeInnings(
    tenantId: string,
    matchId: string,
    inningsId: string,
  ): Promise<CompleteInningsResult> {
    const result = await db.transaction(async (tx) => {
      // Same lock ordering as delivery/undo; completion cannot race a write.
      await tx.execute(sql`SELECT ${matches.id} FROM ${matches}
        WHERE ${matches.id} = ${matchId} AND ${matches.tenantId} = ${tenantId} FOR UPDATE`);
      const innings = await tx.query.matchInnings.findFirst({
        where: and(
          eq(matchInnings.id, inningsId),
          eq(matchInnings.matchId, matchId),
          eq(matchInnings.tenantId, tenantId),
        ),
      });

      assertTenantScope(tenantId, innings, 'Innings', inningsId);

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

      const match = await tx.query.matches.findFirst({
        where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
      });

      assertTenantScope(tenantId, match, 'Match', matchId);

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
      };
    });

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
    matchId: string,
    winnerId?: string,
    result?: string,
  ): Promise<void> {
    // Confirm ownership first: a bare UPDATE would silently succeed on a
    // cross-tenant id (and would not even report that it matched nothing).
    const match = await db.query.matches.findFirst({
      where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
    });

    assertTenantScope(tenantId, match, 'Match', matchId);

    // Idempotent: `completeMatch` may be called more than once (retry, double
    // click, a client re-issuing the request). Only emit `MatchEnded` on the
    // actual transition, otherwise every repeat would generate another summary.
    const wasAlreadyComplete = match.status === 'completed';

    await db.update(matches)
      .set({
        status: 'completed',
        winnerId: winnerId || null,
        result: result || null,
        endDate: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)));

    // Same reasoning as completeInnings: the match-state cache holds a stale
    // status otherwise.
    this.redis.del(`match:state:${matchId}`).catch((err) =>
      this.logger.warn(
        `Failed to invalidate match state cache for ${matchId}: ${err}`,
      ),
    );

    this.logger.log(`Match ${matchId} marked as completed`);

    if (!wasAlreadyComplete) {
      // After the write, so consumers cannot observe an end event for a match
      // that is not yet completed in the database.
      this.publishMatchEnded(matchId, tenantId, winnerId, result).catch((err) =>
        this.logger.warn(`Failed to publish MatchEnded after completion: ${err}`),
      );
    }
  }

  /**
   * Resolves the display names the `MatchStarted` prompt reads and publishes it.
   *
   * Runs post-commit on a path that fires at most once per match, so the extra
   * lookups are not on the hot path. Names are resolved defensively — a missing
   * team or venue must degrade the intro wording, not fail the publish.
   */
  private async publishMatchStarted(
    match: { id: string; tenantId: string; teamAId: string; teamBId: string; tournamentId?: string | null; venueId?: string | null },
  ): Promise<void> {
    const [teamA, teamB, venue, tournament] = await Promise.all([
      db.query.teams.findFirst({ where: eq(teams.id, match.teamAId) }),
      db.query.teams.findFirst({ where: eq(teams.id, match.teamBId) }),
      match.venueId
        ? db.query.venues.findFirst({ where: eq(venues.id, match.venueId) })
        : Promise.resolve(null),
      match.tournamentId
        ? db.query.tournaments.findFirst({ where: eq(tournaments.id, match.tournamentId) })
        : Promise.resolve(null),
    ]);

    await this.kafkaPublisher.publishMatchEvent({
      type: 'MatchStarted',
      matchId: match.id,
      tenantId: match.tenantId,
      eventId: `${match.id}:MatchStarted`,
      timestamp: new Date().toISOString(),
      data: {
        teamAName: teamA?.name ?? 'Team A',
        teamBName: teamB?.name ?? 'Team B',
        venueName: venue?.name ?? null,
        tournamentName: tournament?.name ?? null,
      },
    });
  }

  /** Resolves winner / player-of-the-match names and publishes `MatchEnded`. */
  private async publishMatchEnded(
    matchId: string,
    tenantId: string,
    winnerId?: string,
    result?: string,
  ): Promise<void> {
    const [winner, motm] = await Promise.all([
      winnerId ? db.query.teams.findFirst({ where: eq(teams.id, winnerId) }) : Promise.resolve(null),
      db.query.matches
        .findFirst({
          where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
        })
        .then((m) =>
          m?.manOfMatchId
            ? db.query.players.findFirst({ where: eq(players.id, m.manOfMatchId) })
            : null,
        ),
    ]);

    await this.kafkaPublisher.publishMatchEvent({
      type: 'MatchEnded',
      matchId,
      tenantId,
      eventId: `${matchId}:MatchEnded`,
      timestamp: new Date().toISOString(),
      data: {
        winnerName: winner?.name ?? null,
        result: result ?? null,
        motmName: motm?.name ?? null,
      },
    });
  }
}

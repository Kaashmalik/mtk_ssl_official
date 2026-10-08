import {
  Injectable,
  Logger,
  BadRequestException,
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
  scorecard: Scorecard;
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
    const { matchId, inningsId } = ballEvent;

    const { result, publishData, becameLive, match } = await db.transaction(async (tx) => {
      // 1. Validate match exists, belongs to this tenant, and is in a scorable
      //    state. Scoping the WHERE clause (not just comparing afterwards) means
      //    a cross-tenant id never even reaches the comparison.
      const match = await tx.query.matches.findFirst({
        where: and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)),
      });

      assertTenantScope(tenantId, match, 'Match', matchId);

      if (match.status === 'completed' || match.status === 'abandoned') {
        throw new BadRequestException(`Match ${matchId} is already ${match.status}`);
      }

      // 2. Validate innings exists within this tenant and this match
      const innings = await tx.query.matchInnings.findFirst({
        where: and(
          eq(matchInnings.id, inningsId),
          eq(matchInnings.matchId, matchId),
          eq(matchInnings.tenantId, tenantId)
        ),
      });

      assertTenantScope(tenantId, innings, 'Innings', inningsId);

      // 3. Check for duplicate ball (unique constraint on match_id, innings_id, over, ball)
      const existingBall = await tx.query.matchBalls.findFirst({
        where: and(
          eq(matchBalls.matchId, matchId),
          eq(matchBalls.inningsId, inningsId),
          eq(matchBalls.overNumber, ballEvent.over),
          eq(matchBalls.ballNumber, ballEvent.ball),
          eq(matchBalls.tenantId, tenantId)
        ),
      });

      if (existingBall) {
        throw new BadRequestException(
          `Ball ${ballEvent.over}.${ballEvent.ball} already recorded for this innings`
        );
      }

      // 4. Determine ball properties from event
      const isWide = ballEvent.extras?.type === 'wide';
      const isNoBall = ballEvent.extras?.type === 'noball';
      const isBye = ballEvent.extras?.type === 'bye';
      const isLegBye = ballEvent.extras?.type === 'legbye';
      const isWicket = !!ballEvent.wicket;
      const totalRuns = ballEvent.runs + (ballEvent.extras?.runs || 0);
      const isFour = totalRuns === 4 && !isWide && !isNoBall && !isBye && !isLegBye;
      const isSix = totalRuns === 6 && !isWide && !isNoBall && !isBye && !isLegBye;

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

      // Insert into scoringEvents (immutability event store)
      const lastEvent = await tx.select({ seq: sql<number>`COALESCE(MAX(sequence_number), 0)` })
        .from(scoringEvents)
        .where(eq(scoringEvents.aggregateId, inningsId));
      const nextSeq = (lastEvent[0]?.seq || 0) + 1;

      const [recordedEvent] = await tx.insert(scoringEvents)
        .values({
          tenantId: match.tenantId,
          matchId: matchId,
          inningsId: inningsId,
          eventType: 'ball_recorded',
          eventVersion: 1,
          aggregateId: inningsId,
          sequenceNumber: nextSeq,
          payload: {
            runs: totalRuns,
            is_wicket: isWicket,
            is_wide: isWide,
            is_no_ball: isNoBall,
            is_bye: isBye,
            is_leg_bye: isLegBye,
            batsman_runs: ballEvent.runs,
          },
        })
        .returning({ id: scoringEvents.id, sequenceNumber: scoringEvents.sequenceNumber });

      // 5. Insert the ball record
      const ballInsert: NewMatchBall = {
        tenantId: match.tenantId,
        matchId,
        inningsId,
        overNumber: ballEvent.over,
        ballNumber: ballEvent.ball,
        bowlerId: ballEvent.bowlerId || null,
        batsmanId: ballEvent.batsmanId || null,
        runs: ballEvent.runs,
        isWicket,
        wicketType: isWicket ? (ballEvent.wicket!.type as any) : null,
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

      // 6. Incrementally update innings aggregates (O(1) - no recalculation)
      const extrasRuns = (isWide || isNoBall) ? (ballEvent.extras?.runs || 0) : 0;
      const byesRuns = isBye ? ballEvent.runs : 0;
      const legByesRuns = isLegBye ? ballEvent.runs : 0;

      await tx.update(matchInnings)
        .set({
          totalRuns: sql`${matchInnings.totalRuns} + ${totalRuns}`,
          totalWickets: sql`${matchInnings.totalWickets} + ${isWicket ? 1 : 0}`,
          totalBalls: sql`${matchInnings.totalBalls} + ${(!isWide && !isNoBall) ? 1 : 0}`,
          extras: sql`${matchInnings.extras} + ${extrasRuns}`,
          byes: sql`${matchInnings.byes} + ${byesRuns}`,
          legByes: sql`${matchInnings.legByes} + ${legByesRuns}`,
          wides: sql`${matchInnings.wides} + ${isWide ? 1 : 0}`,
          noBalls: sql`${matchInnings.noBalls} + ${isNoBall ? 1 : 0}`,
          status: 'in_progress',
          updatedAt: new Date(),
        })
        .where(and(eq(matchInnings.id, inningsId), eq(matchInnings.tenantId, tenantId)));

      // 7. Update match status to live if not already
      if (match.status === 'scheduled') {
        await tx.update(matches)
          .set({
            status: 'live',
            startDate: new Date(),
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

      const totalBalls = updatedInnings.totalBalls;
      const overs = Math.floor(totalBalls / 6) + (totalBalls % 6) / 10;
      const runRate = totalBalls > 0 ? (updatedInnings.totalRuns / (totalBalls / 6)) : 0;

      const scorecard: Scorecard = {
        matchId,
        innings: updatedInnings.inningsNumber,
        totalRuns: updatedInnings.totalRuns,
        totalWickets: updatedInnings.totalWickets,
        overs: Math.floor(totalBalls / 6),
        balls: totalBalls % 6,
        runRate: Number(runRate.toFixed(2)),
      };

      this.logger.log(
        `Ball ${ballEvent.over}.${ballEvent.ball}: ${totalRuns} runs${isWicket ? ' + WICKET' : ''} ` +
        `| Score: ${scorecard.totalRuns}/${scorecard.totalWickets} (${scorecard.overs}.${scorecard.balls})`
      );

      const result = {
        ballId: insertedBall.id,
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

      // Invalidate cache after database transaction commits
      const cacheKey = `match:state:${matchId}`;
      this.redis.del(cacheKey).catch((err) => 
        this.logger.warn(`Failed to invalidate match state cache: ${err}`)
      );

      return { result, publishData, becameLive, match };
    });

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
    return await db.transaction(async (tx) => {
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
        orderBy: [desc(matchBalls.createdAt)],
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

      // 3. Determine what to subtract
      const isWide = ball.isWide;
      const isNoBall = ball.isNoBall;
      const isBye = ball.isBye;
      const isLegBye = ball.isLegBye;
      const isWicket = ball.isWicket;
      const totalRuns = ball.runs + (isWide || isNoBall ? 1 : 0); // Base runs + extra runs

      // Insert undo event into scoringEvents
      const lastEvent = await tx.select({ seq: sql<number>`COALESCE(MAX(sequence_number), 0)` })
        .from(scoringEvents)
        .where(eq(scoringEvents.aggregateId, ball.inningsId));
      const nextSeq = (lastEvent[0]?.seq || 0) + 1;

      await tx.insert(scoringEvents).values({
        tenantId: innings.tenantId,
        matchId: matchId,
        inningsId: ball.inningsId,
        eventType: 'ball_undone',
        eventVersion: 1,
        aggregateId: ball.inningsId,
        sequenceNumber: nextSeq,
        payload: {
          runs: totalRuns,
          is_wicket: isWicket,
          is_wide: isWide,
          is_no_ball: isNoBall,
          is_bye: isBye,
          is_leg_bye: isLegBye,
          batsman_runs: ball.runs,
        },
      });

      // 4. Delete the ball record (cascade will handle related data)
      await tx.delete(matchBalls)
        .where(eq(matchBalls.id, ballId));

      // 5. Decrement innings aggregates
      const extrasRuns = (isWide || isNoBall) ? 1 : 0;
      const byesRuns = isBye ? ball.runs : 0;
      const legByesRuns = isLegBye ? ball.runs : 0;

      await tx.update(matchInnings)
        .set({
          totalRuns: sql`GREATEST(0, ${matchInnings.totalRuns} - ${totalRuns})`,
          totalWickets: sql`GREATEST(0, ${matchInnings.totalWickets} - ${isWicket ? 1 : 0})`,
          totalBalls: sql`GREATEST(0, ${matchInnings.totalBalls} - ${(!isWide && !isNoBall) ? 1 : 0})`,
          extras: sql`GREATEST(0, ${matchInnings.extras} - ${extrasRuns})`,
          byes: sql`GREATEST(0, ${matchInnings.byes} - ${byesRuns})`,
          legByes: sql`GREATEST(0, ${matchInnings.legByes} - ${legByesRuns})`,
          wides: sql`GREATEST(0, ${matchInnings.wides} - ${isWide ? 1 : 0})`,
          noBalls: sql`GREATEST(0, ${matchInnings.noBalls} - ${isNoBall ? 1 : 0})`,
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

      const totalBalls = updatedInnings.totalBalls;
      const runRate = totalBalls > 0 ? (updatedInnings.totalRuns / (totalBalls / 6)) : 0;

      const scorecard: Scorecard = {
        matchId,
        innings: updatedInnings.inningsNumber,
        totalRuns: updatedInnings.totalRuns,
        totalWickets: updatedInnings.totalWickets,
        overs: Math.floor(totalBalls / 6),
        balls: totalBalls % 6,
        runRate: Number(runRate.toFixed(2)),
      };

      this.logger.log(
        `UNDO ball ${ballId}: removed ${totalRuns} runs${isWicket ? ' + wicket' : ''} ` +
        `| Score: ${scorecard.totalRuns}/${scorecard.totalWickets}`
      );

      const result = {
        ballId,
        scorecard,
      };

      // Invalidate cache after database transaction commits
      const cacheKey = `match:state:${matchId}`;
      this.redis.del(cacheKey).catch((err) => 
        this.logger.warn(`Failed to invalidate match state cache: ${err}`)
      );

      return result;
    });
  }

  async getBallHistory(matchId: string, inningsId: string, limit: number = 50) {
    return db.query.matchBalls.findMany({
      where: and(
        eq(matchBalls.matchId, matchId),
        eq(matchBalls.inningsId, inningsId)
      ),
      orderBy: [desc(matchBalls.createdAt)],
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

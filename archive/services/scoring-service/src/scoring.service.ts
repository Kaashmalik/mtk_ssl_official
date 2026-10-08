import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '@mtk/database';
import {
  matchBalls,
  matchInnings,
  matches,
  NewMatchBall,
  scoringEvents,
  scorecardProjections,
} from '@mtk/database';
import Redis from 'ioredis';
import { env } from './env';

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

export interface Scorecard {
  matchId: string;
  innings: number;
  totalRuns: number;
  totalWickets: number;
  overs: number;
  balls: number;
  runRate: number;
}

export interface BallResult {
  ballId: string;
  scorecard: Scorecard;
}

export interface MatchState {
  matchId: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'abandoned';
  innings1?: Scorecard;
  innings2?: Scorecard;
  currentInnings: number;
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      maxRetriesPerRequest: null,
    });
  }

  async getMatchState(matchId: string): Promise<MatchState | null> {
    const cacheKey = `match:state:${matchId}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for match state: ${matchId}`);
        return JSON.parse(cached);
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
        status: match.status as MatchState['status'],
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

  async recordBall(ballEvent: BallEvent): Promise<BallResult> {
    const { matchId, inningsId } = ballEvent;

    return await db.transaction(async (tx) => {
      // 1. Validate match exists and is in a scorable state
      const match = await tx.query.matches.findFirst({
        where: eq(matches.id, matchId),
      });

      if (!match) {
        throw new NotFoundException(`Match ${matchId} not found`);
      }

      if (match.status === 'completed' || match.status === 'abandoned') {
        throw new BadRequestException(`Match ${matchId} is already ${match.status}`);
      }

      // 2. Validate innings exists
      const innings = await tx.query.matchInnings.findFirst({
        where: and(
          eq(matchInnings.id, inningsId),
          eq(matchInnings.matchId, matchId)
        ),
      });

      if (!innings) {
        throw new NotFoundException(`Innings ${inningsId} not found for match ${matchId}`);
      }

      // 3. Check for duplicate ball (unique constraint on match_id, innings_id, over, ball)
      const existingBall = await tx.query.matchBalls.findFirst({
        where: and(
          eq(matchBalls.matchId, matchId),
          eq(matchBalls.inningsId, inningsId),
          eq(matchBalls.overNumber, ballEvent.over),
          eq(matchBalls.ballNumber, ballEvent.ball)
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

      await tx.insert(scoringEvents).values({
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
      });

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
        .where(eq(matchInnings.id, inningsId));

      // 7. Update match status to live if not already
      if (match.status === 'scheduled') {
        await tx.update(matches)
          .set({
            status: 'live',
            startDate: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(matches.id, matchId));
      }

      // 8. Fetch updated innings for the response scorecard
      const updatedInnings = await tx.query.matchInnings.findFirst({
        where: eq(matchInnings.id, inningsId),
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

      // Invalidate cache after database transaction commits
      const cacheKey = `match:state:${matchId}`;
      this.redis.del(cacheKey).catch((err) => 
        this.logger.warn(`Failed to invalidate match state cache: ${err}`)
      );

      return result;
    });
  }

  async undoBall(matchId: string, ballId: string): Promise<BallResult> {
    return await db.transaction(async (tx) => {
      // 1. Find the ball to undo
      const ball = await tx.query.matchBalls.findFirst({
        where: and(
          eq(matchBalls.id, ballId),
          eq(matchBalls.matchId, matchId)
        ),
      });

      if (!ball) {
        throw new NotFoundException(`Ball ${ballId} not found in match ${matchId}`);
      }

      // Verify that this is the last recorded ball in this innings to prevent cascading database drift
      const lastRecordedBall = await tx.query.matchBalls.findFirst({
        where: eq(matchBalls.inningsId, ball.inningsId),
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
        where: eq(matchInnings.id, ball.inningsId),
      });

      if (!innings) {
        throw new NotFoundException(`Innings ${ball.inningsId} not found`);
      }

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
        .where(eq(matchInnings.id, ball.inningsId));

      // 6. Fetch updated state
      const updatedInnings = await tx.query.matchInnings.findFirst({
        where: eq(matchInnings.id, ball.inningsId),
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

  async completeInnings(inningsId: string): Promise<void> {
    await db.update(matchInnings)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(matchInnings.id, inningsId));

    this.logger.log(`Innings ${inningsId} marked as completed`);
  }

  async completeMatch(matchId: string, winnerId?: string, result?: string): Promise<void> {
    await db.update(matches)
      .set({
        status: 'completed',
        winnerId: winnerId || null,
        result: result || null,
        endDate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(matches.id, matchId));

    this.logger.log(`Match ${matchId} marked as completed`);
  }
}

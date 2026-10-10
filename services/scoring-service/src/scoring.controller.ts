import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ScoringService } from './scoring.service';
import { ScoringServiceAuthGuard } from './common/guards/scoring-service-auth.guard';
import { TenantScopeGuard } from './common/guards/tenant-scope.guard';

/**
 * Reads the tenant validated and attached by `TenantScopeGuard`.
 *
 * Every mutation endpoint is guarded by that guard, so this cannot be absent —
 * the throw is a type-narrowing assertion for the compiler, not a runtime path.
 */
function tenantIdOf(req: Request): string {
  const tenantId = (req as Request & { tenantId?: string }).tenantId;
  if (!tenantId) {
    throw new BadRequestException('Tenant scope missing from request context');
  }
  return tenantId;
}

class RecordBallDto {
  matchId: string;
  inningsId: string;
  over: number;
  ball: number;
  runs: number;
  extras?: { type: 'wide' | 'noball' | 'bye' | 'legbye'; runs: number };
  wicket?: { type: string; playerId: string; fielderId?: string };
  batsmanId: string;
  bowlerId: string;
  clientOpId: string;
}

class CreateInningsDto {
  matchId: string;
  teamId: string;
  inningsNumber: number;
}

/** Guards for every scoring mutation: service token **and** tenant scope. */
const MUTATION_GUARDS = [
  ThrottlerGuard,
  ScoringServiceAuthGuard,
  TenantScopeGuard,
] as const;

@Controller('scoring')
@UseGuards(ThrottlerGuard)
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  // Reads stay unauthenticated so public scoreboards can poll state. They only
  // ever expose scorecard numbers for a match the caller already holds a UUID
  // for, and the public pages themselves resolve the tenant before rendering.

  @Get('match/:matchId/state')
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 requests per minute for state polling
  async getMatchState(@Param('matchId') matchId: string) {
    return this.scoringService.getMatchState(matchId);
  }

  @Get('match/:matchId/innings/:inningsId/history')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getBallHistory(
    @Param('matchId') matchId: string,
    @Param('inningsId') inningsId: string,
  ) {
    return this.scoringService.getBallHistory(matchId, inningsId, 100);
  }

  @Post('ball')
  @UseGuards(...MUTATION_GUARDS)
  @Throttle({ default: { limit: 120, ttl: 60000 } }) // 120 ball records per minute (generous for rapid scoring)
  @HttpCode(HttpStatus.CREATED)
  async recordBall(@Req() req: Request, @Body() dto: RecordBallDto) {
    // The canonical service validates the full command for every entry point.
    return this.scoringService.recordBall(tenantIdOf(req), {
      ...dto,
      timestamp: new Date(),
    });
  }

  @Post('ball/undo')
  @UseGuards(...MUTATION_GUARDS)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 undos per minute
  async undoBall(
    @Req() req: Request,
    @Body() body: { matchId: string; ballId: string },
  ) {
    return this.scoringService.undoBall(
      tenantIdOf(req),
      body.matchId,
      body.ballId,
    );
  }

  @Post('innings')
  @UseGuards(...MUTATION_GUARDS)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  async createInnings(@Req() req: Request, @Body() dto: CreateInningsDto) {
    return this.scoringService.createInnings(tenantIdOf(req), {
      matchId: dto.matchId,
      teamId: dto.teamId,
      inningsNumber: Number(dto.inningsNumber),
    });
  }

  /**
   * `matchId` is required alongside `inningsId` so the service can scope the
   * innings to its parent match instead of trusting a bare innings id.
   */
  @Post('innings/:inningsId/complete')
  @UseGuards(...MUTATION_GUARDS)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async completeInnings(
    @Req() req: Request,
    @Param('inningsId') inningsId: string,
    @Body() body: { matchId: string },
  ) {
    return this.scoringService.completeInnings(
      tenantIdOf(req),
      body.matchId,
      inningsId,
    );
  }

  @Post('match/:matchId/complete')
  @UseGuards(...MUTATION_GUARDS)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async completeMatch(
    @Req() req: Request,
    @Param('matchId') matchId: string,
    @Body() body: { winnerId?: string; result?: string },
  ) {
    await this.scoringService.completeMatch(
      tenantIdOf(req),
      matchId,
      body.winnerId,
      body.result,
    );
    return { success: true, matchId, status: 'completed' };
  }
}

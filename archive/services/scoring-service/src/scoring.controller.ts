import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ScoringService } from './scoring.service';

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
}

@Controller('scoring')
@UseGuards(ThrottlerGuard)
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

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
  @Throttle({ default: { limit: 120, ttl: 60000 } }) // 120 ball records per minute (generous for rapid scoring)
  @HttpCode(HttpStatus.CREATED)
  async recordBall(@Body() dto: RecordBallDto) {
    if (dto.over < 0 || dto.ball < 1 || dto.ball > 6) {
      throw new BadRequestException('Invalid over or ball number');
    }
    if (dto.runs < 0 || dto.runs > 6) {
      throw new BadRequestException('Runs must be between 0 and 6');
    }

    return this.scoringService.recordBall({
      ...dto,
      timestamp: new Date(),
    });
  }

  @Post('ball/undo')
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 undos per minute
  async undoBall(
    @Body() body: { matchId: string; ballId: string },
  ) {
    return this.scoringService.undoBall(body.matchId, body.ballId);
  }

  @Post('innings/:inningsId/complete')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async completeInnings(@Param('inningsId') inningsId: string) {
    await this.scoringService.completeInnings(inningsId);
    return { success: true, inningsId, status: 'completed' };
  }

  @Post('match/:matchId/complete')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async completeMatch(
    @Param('matchId') matchId: string,
    @Body() body: { winnerId?: string; result?: string },
  ) {
    await this.scoringService.completeMatch(matchId, body.winnerId, body.result);
    return { success: true, matchId, status: 'completed' };
  }
}

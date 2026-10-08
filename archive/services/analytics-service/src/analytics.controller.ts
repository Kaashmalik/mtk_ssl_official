import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { ClickhouseService } from './clickhouse.service';

@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly clickhouse: ClickhouseService) {}

  @Get('leaderboard/batting/:tenantId')
  async getBattingLeaderboard(
    @Param('tenantId') tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.clickhouse.queryTopRunScorers(tenantId, limit ? parseInt(limit) : 10);
  }

  @Get('leaderboard/bowling/:tenantId')
  async getBowlingLeaderboard(
    @Param('tenantId') tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.clickhouse.queryTopWicketTakers(tenantId, limit ? parseInt(limit) : 10);
  }

  @Get('match/:matchId/runrate')
  async getMatchRunRate(@Param('matchId') matchId: string) {
    return this.clickhouse.queryMatchRunRate(matchId);
  }
}

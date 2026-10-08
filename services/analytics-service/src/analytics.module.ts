import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClickhouseService } from './clickhouse.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  controllers: [AnalyticsController],
  providers: [ClickhouseService],
  exports: [ClickhouseService],
})
export class AnalyticsModule {}

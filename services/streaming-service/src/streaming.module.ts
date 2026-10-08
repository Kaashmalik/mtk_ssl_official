import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StreamingService } from './streaming.service';
import { StreamingGateway } from './streaming.gateway';
import { MediasoupRouterService } from './mediasoup-router.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [StreamingService, StreamingGateway, MediasoupRouterService],
  exports: [StreamingService],
})
export class StreamingModule {}

import { Controller, Post, Body, Headers, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { timingSafeEqual } from 'crypto';
import { NotificationService } from './notification.service';

interface SendNotificationDto {
  tenantId: string;
  userId?: string;
  topic?: string;
  channels: ('push' | 'email' | 'sms')[];
  title: string;
  body: string;
  data?: Record<string, string>;
  email?: string;
  phone?: string;
}

/**
 * ENH-01-04 (quarantine of legacy notification writers): these HTTP writers
 * could send push/email/SMS/broadcast to ANY tenant or user with no auth and
 * have no callers in the repo. They are quarantined fail-closed behind a
 * shared service token (NOTIFICATION_SERVICE_TOKEN, constant-time compared):
 *   - token not configured   -> 503: the writers stay quarantined
 *   - wrong/missing bearer   -> 401
 * The 'ssl.*' Kafka feeds are internal pipeline inputs and stay authorized.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  private assertWriterAuthorized(authorization?: string): void {
    const expected = process.env.NOTIFICATION_SERVICE_TOKEN;
    if (!expected) {
      throw new ServiceUnavailableException(
        'Notification writers are quarantined: NOTIFICATION_SERVICE_TOKEN is not configured',
      );
    }
    const provided = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    const matches = a.length === b.length && timingSafeEqual(a, b);
    if (!matches) {
      throw new UnauthorizedException('Notification writers require the service token');
    }
  }

  @Post('send')
  async send(
    @Body() dto: SendNotificationDto,
    @Headers('authorization') authorization?: string,
  ) {
    this.assertWriterAuthorized(authorization);
    return this.notificationService.send(dto);
  }

  @Post('broadcast')
  async broadcast(
    @Body() dto: { tenantId: string; topic: string; title: string; body: string },
    @Headers('authorization') authorization?: string,
  ) {
    this.assertWriterAuthorized(authorization);
    return this.notificationService.broadcast(dto);
  }

  @Post('register')
  async register(
    @Body() dto: { userId?: string; clerkId?: string; token: string; platform?: string },
    @Headers('authorization') authorization?: string,
  ) {
    this.assertWriterAuthorized(authorization);
    return this.notificationService.registerPushToken(dto);
  }

  // Kafka event handlers
  @MessagePattern('ssl.match.events')
  async handleMatchEvent(@Payload() event: { type: string; data: Record<string, unknown> }) {
    switch (event.type) {
      case 'MatchStarted':
        await this.notificationService.notifyMatchStart(event.data);
        break;
      case 'MatchEnded':
        await this.notificationService.notifyMatchEnd(event.data);
        break;
      case 'WicketFallen':
        await this.notificationService.notifyWicket(event.data);
        break;
    }
  }

  @MessagePattern('ssl.scoring.ball-events')
  async handleScoringEvent(@Payload() event: { type: string; data: Record<string, unknown> }) {
    if (event.type === 'SIX_HIT' || event.type === 'FOUR_HIT') {
      await this.notificationService.notifyBoundary(event.data);
    }
  }

  @MessagePattern('ssl.tournament.events')
  async handleTournamentEvent(@Payload() event: { type: string; data: Record<string, unknown> }) {
    if (event.type === 'TournamentStarted') {
      await this.notificationService.notifyTournamentStart(event.data);
    }
  }
}

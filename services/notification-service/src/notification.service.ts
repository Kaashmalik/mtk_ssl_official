import { Injectable, Logger, Optional } from '@nestjs/common';
import { PushService } from './channels/push.service';
import { EmailService } from './channels/email.service';
import { SmsService } from './channels/sms.service';
import { NotificationGateway } from './notification.gateway';
import { db, notifications, pushTokens, users } from '@mtk/database';
import { and, eq } from 'drizzle-orm';

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

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly pushService: PushService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    /**
     * Optional: the gateway is registered in the same module but NestJS
     * resolves providers lazily; using @Optional() prevents a hard failure
     * during tests that do not mount the full WS infrastructure.
     */
    @Optional() private readonly gateway: NotificationGateway,
  ) {}

  async send(dto: SendNotificationDto): Promise<{ success: boolean; results: Record<string, boolean> }> {
    const results: Record<string, boolean> = {};

    for (const channel of dto.channels) {
      try {
        switch (channel) {
          case 'push':
            if (dto.userId) {
              results.push = await this.pushService.sendToUser(dto.userId, {
                title: dto.title,
                body: dto.body,
                data: dto.data,
              });
            } else if (dto.topic) {
              results.push = await this.pushService.sendToTopic(dto.topic, {
                title: dto.title,
                body: dto.body,
                data: dto.data,
              });
            }
            break;

          case 'email':
            if (dto.email) {
              results.email = await this.emailService.send({
                to: dto.email,
                subject: dto.title,
                body: dto.body,
              });
            }
            break;

          case 'sms':
            if (dto.phone) {
              results.sms = await this.smsService.send({
                to: dto.phone,
                message: `${dto.title}: ${dto.body}`,
              });
            }
            break;
        }
      } catch (error) {
        this.logger.error(`Failed to send ${channel} notification`, error);
        results[channel] = false;
      }
    }

    return {
      success: Object.values(results).some(Boolean),
      results,
    };
  }

  async broadcast(dto: { tenantId: string; topic: string; title: string; body: string }): Promise<{ success: boolean }> {
    const topic = `${dto.tenantId}_${dto.topic}`;
    const success = await this.pushService.sendToTopic(topic, {
      title: dto.title,
      body: dto.body,
    });
    return { success };
  }

  private async persistInApp(input: {
    tenantId?: string;
    userId?: string | null;
    type: string;
    title: string;
    body: string;
  }) {
    // tenant_id is NOT NULL on notifications — skip when the event has no tenant.
    if (!input.tenantId) {
      this.logger.warn(`Skipping in-app notification "${input.type}" — missing tenantId`);
      return;
    }
    try {
      const [row] = await db.insert(notifications).values({
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        type: input.type,
        channel: 'in_app',
        title: input.title,
        body: input.body,
        status: 'delivered',
        deliveredAt: new Date(),
      }).returning();

      // Real-time delivery via WebSocket gateway.
      // Fire-and-forget: a missing or unready gateway must never roll back the
      // DB write, which is the durable record.
      if (row && this.gateway) {
        const payload = {
          id: row.id,
          type: row.type,
          title: row.title,
          body: row.body,
          createdAt: row.createdAt ?? new Date(),
        };
        if (input.userId) {
          // Personal notification — send to the specific user's room
          this.gateway.emitToUser(input.userId, payload);
        } else {
          // Tenant-wide notification — broadcast to the tenant room
          this.gateway.emitToTenant(input.tenantId, payload);
        }
      }
    } catch (error) {
      this.logger.error('Failed to persist in-app notification', error instanceof Error ? error.message : error);
    }
  }


  async registerPushToken(dto: { userId?: string; clerkId?: string; token: string; platform?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      let userId = dto.userId ?? null;
      if (!userId && dto.clerkId) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.clerkId, dto.clerkId)).limit(1);
        userId = u?.id ?? null;
      }
      // push_tokens.user_id is NOT NULL — a token must be attributable to a user.
      if (!userId) {
        this.logger.warn('Rejected push token registration: no resolvable user identity');
        return { success: false, error: 'userId or clerkId is required' };
      }

      const [existing] = await db
        .select({ id: pushTokens.id })
        .from(pushTokens)
        .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, dto.token)))
        .limit(1);

      if (existing) {
        await db
          .update(pushTokens)
          .set({ platform: dto.platform ?? null, isActive: true, lastUsedAt: new Date() })
          .where(eq(pushTokens.id, existing.id));
      } else {
        await db.insert(pushTokens).values({
          userId,
          token: dto.token,
          platform: dto.platform ?? null,
        });
      }
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to register push token', error instanceof Error ? error.message : error);
      return { success: false, error: 'registration failed' };
    }
  }

  async notifyMatchStart(data: Record<string, unknown>): Promise<void> {
    const tenantId = data.tenantId as string;
    const matchId = (data.id ?? data.matchId) as string;

    await this.persistInApp({
      tenantId,
      type: 'match_start',
      title: 'Match Started!',
      body: 'The match is now live. Tap to watch.',
    });

    await this.broadcast({
      tenantId,
      topic: `match_${matchId}`,
      title: 'Match Started!',
      body: `The match is now live. Tap to watch.`,
    });
  }

  async notifyMatchEnd(data: Record<string, unknown>): Promise<void> {
    const tenantId = data.tenantId as string;
    const matchId = (data.id ?? data.matchId) as string;
    const result = data.result as string;

    await this.persistInApp({
      tenantId,
      type: 'match_end',
      title: 'Match Ended',
      body: result || 'The match has concluded.',
    });

    await this.broadcast({
      tenantId,
      topic: `match_${matchId}`,
      title: 'Match Ended',
      body: result || 'The match has concluded.',
    });
  }

  async notifyWicket(data: Record<string, unknown>): Promise<void> {
    const tenantId = data.tenantId as string;
    const matchId = data.matchId as string;
    const player = data.playerName as string;

    await this.persistInApp({
      tenantId,
      type: 'wicket',
      title: 'Wicket!',
      body: `${player} is out!`,
    });

    await this.broadcast({
      tenantId,
      topic: `match_${matchId}`,
      title: 'WICKET!',
      body: `${player} is out!`,
    });
  }

  async notifyBoundary(data: Record<string, unknown>): Promise<void> {
    const tenantId = data.tenantId as string;
    const matchId = data.matchId as string;
    const runs = data.runs as number;
    const player = data.batsmanName as string;
    
    await this.broadcast({
      tenantId,
      topic: `match_${matchId}`,
      title: runs === 6 ? '🚀 SIX!' : '4️⃣ FOUR!',
      body: `${player} hits a ${runs === 6 ? 'massive six' : 'beautiful four'}!`,
    });
  }

  async notifyTournamentStart(data: Record<string, unknown>): Promise<void> {
    const tenantId = data.tenantId as string;
    const name = data.name as string;
    
    await this.broadcast({
      tenantId,
      topic: 'tournaments',
      title: '🏆 Tournament Started',
      body: `${name} has officially begun!`,
    });
  }
}

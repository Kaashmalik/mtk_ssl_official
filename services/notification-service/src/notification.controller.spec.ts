import { NotificationController } from './notification.controller';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

// The controller chains into NotificationService -> @mtk/database, whose dist
// build is ESM and unparseable by jest. These tests never touch the database;
// stub the module so the real (ESM) entry point is never loaded.
jest.mock('@mtk/database', () => ({
  db: {},
  users: {},
  pushTokens: {},
  notifications: {},
}));

/**
 * ENH-01-04 (quarantine of legacy notification writers): the HTTP writers
 * (`/send`, `/broadcast`, `/register`) were callable by ANYONE who could
 * reach the port - push/email/SMS/broadcast to any tenant or user, no auth.
 * There are no callers in the repo; the safe posture is fail-closed:
 *   - no NOTIFICATION_SERVICE_TOKEN configured  -> 503 (quarantined)
 *   - token configured, header missing/mismatch -> 401
 *   - token matches (constant-time)             -> delegate to the service
 * Kafka event feeds ('ssl.*' MessagePatterns) are internal pipeline inputs
 * and keep working.
 */

const SERVICE = {
  send: jest.fn(async () => ({ success: true, results: {} })),
  broadcast: jest.fn(async () => ({ success: true })),
  registerPushToken: jest.fn(async () => ({ success: true })),
  notifyMatchStart: jest.fn(async () => undefined),
  notifyMatchEnd: jest.fn(async () => undefined),
  notifyWicket: jest.fn(async () => undefined),
  notifyBoundary: jest.fn(async () => undefined),
  notifyTournamentStart: jest.fn(async () => undefined),
};

const controller = () => new NotificationController(SERVICE as never);

const withToken = async (value: string | undefined, run: () => Promise<void>) => {
  const previous = process.env.NOTIFICATION_SERVICE_TOKEN;
  if (value === undefined) delete process.env.NOTIFICATION_SERVICE_TOKEN;
  else process.env.NOTIFICATION_SERVICE_TOKEN = value;
  try {
    // The window must span the ENTIRE awaited body - restoring early would
    // let the guard read a restored (missing) env.
    await run();
  } finally {
    if (previous === undefined) delete process.env.NOTIFICATION_SERVICE_TOKEN;
    else process.env.NOTIFICATION_SERVICE_TOKEN = previous;
  }
};

// The controller receives the ALREADY-EXTRACTED header value (what Nest's
// @Headers('authorization') injects), so the helper is the raw string value.
const authHeader = (token: string) => `Bearer ${token}` as never;

describe('notification writer quarantine (ENH-01-04)', () => {
  beforeEach(() => {
    SERVICE.send.mockClear();
    SERVICE.broadcast.mockClear();
    SERVICE.registerPushToken.mockClear();
  });

  it('refuses all HTTP writers with 503 while no service token is configured', async () => {
    await withToken(undefined, async () => {
      await expect(controller().send({} as never)).rejects.toThrow(ServiceUnavailableException);
      await expect(controller().broadcast({} as never)).rejects.toThrow(ServiceUnavailableException);
      await expect(controller().register({} as never)).rejects.toThrow(ServiceUnavailableException);
      expect(SERVICE.send).not.toHaveBeenCalled();
    });
  });

  it('refuses writers without or with a wrong bearer while a token IS configured', async () => {
    await withToken('secret-token', async () => {
      await expect(controller().send({} as never)).rejects.toThrow(UnauthorizedException);
      await expect(controller().broadcast({} as never, authHeader('wrong'))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(SERVICE.send).not.toHaveBeenCalled();
      expect(SERVICE.broadcast).not.toHaveBeenCalled();
    });
  });

  it('delegates to the service only for the exact bearer', async () => {
    await withToken('secret-token', async () => {
      const dto = { tenantId: 't', channels: ['push'] as ('push')[], title: 'T', body: 'B' };
      await controller().send(dto as never, authHeader('secret-token'));
      expect(SERVICE.send).toHaveBeenCalledWith(dto);
      await controller().broadcast({ tenantId: 't', topic: 'x', title: 'T', body: 'B' } as never, authHeader('secret-token'));
      expect(SERVICE.broadcast).toHaveBeenCalled();
      await controller().register({ token: 'fcm' } as never, authHeader('secret-token'));
      expect(SERVICE.registerPushToken).toHaveBeenCalledWith({ token: 'fcm' });
    });
  });

  it('Kafka event handlers are internal pipeline inputs and stay authorized', async () => {
    await withToken(undefined, async () => {
      await controller().handleMatchEvent({ type: 'MatchStarted', data: {} });
      expect(SERVICE.notifyMatchStart).toHaveBeenCalled();
    });
  });
});

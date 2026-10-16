import { CommentaryBridgeController } from './commentary-bridge.controller';
import { ScoringGateway } from './scoring.gateway';

jest.mock('./scoring.gateway', () => ({ ScoringGateway: jest.fn() }));
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    set: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    on: jest.fn(),
  })),
}));
jest.mock('./env', () => ({
  env: { REDIS_URL: 'redis://localhost:6379', REDIS_HOST: undefined, REDIS_PORT: undefined },
}));

import Redis from 'ioredis';

const MATCH = '00000000-0000-4000-8000-000000000001';
const payload = {
  matchId: MATCH,
  ballId: '3.4',
  eventId: 'event-9',
  english: 'Four',
  urdu: 'چار',
  punjabi: 'چار',
  pashto: 'څلوریزه',
  sindhi: 'چار',
  timestamp: '2026-10-16T12:00:00Z',
  generatedBy: 'fallback' as const,
};

let redis: { set: jest.Mock; del: jest.Mock; on: jest.Mock };
function context(headers: Record<string, unknown> = {}) {
  return { getMessage: () => ({ headers }) } as never;
}

describe('Commentary bridge publication boundary and redelivery dedupe', () => {
  const gateway = { broadcastCommentary: jest.fn() };
  let controller: CommentaryBridgeController;
  beforeEach(() => {
    jest.clearAllMocks();
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
    };
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    controller = new CommentaryBridgeController(gateway as unknown as ScoringGateway);
  });
  it('routes first-seen commentary through publication-aware forwarding with its claim', async () => {
    await controller.handleCommentary(payload as never, context({ 'idempotency-key': 'event-9' }));
    expect(redis.set).toHaveBeenCalledWith(`forwarded-commentary:event-9`, '1', 'EX', 86400, 'NX');
    expect(gateway.broadcastCommentary).toHaveBeenCalledWith(payload);
  });
  it('does not forward an already-forwarded commentary identity', async () => {
    redis.set.mockResolvedValue(null);
    await controller.handleCommentary(payload as never, context());
    expect(gateway.broadcastCommentary).not.toHaveBeenCalled();
  });
  it('fails open on a claim outage instead of silently dropping the feed', async () => {
    redis.set.mockRejectedValue(new Error('Redis unavailable'));
    await controller.handleCommentary(payload as never, context());
    expect(gateway.broadcastCommentary).toHaveBeenCalledWith(payload);
  });
  it('claims under the payload eventId when no header is present', async () => {
    await controller.handleCommentary(payload as never, context());
    expect(redis.set).toHaveBeenCalledWith('forwarded-commentary:event-9', '1', 'EX', 86400, 'NX');
    expect(gateway.broadcastCommentary).toHaveBeenCalledWith(payload);
  });
  it('forwards a payload without any resolvable identity, without pretending to dedupe it', async () => {
    await controller.handleCommentary({ ...payload, eventId: undefined } as never, context());
    expect(redis.set).not.toHaveBeenCalled();
    expect(gateway.broadcastCommentary).toHaveBeenCalledTimes(1);
  });
  it('releases the claim when forwarding fails so a redelivery retries', async () => {
    gateway.broadcastCommentary.mockRejectedValue(new Error('Gateway unavailable'));
    await controller.handleCommentary(payload as never, context({ 'idempotency-key': 'event-10' }));
    expect(redis.del).toHaveBeenCalledWith('forwarded-commentary:event-10');
  });
  it('does not forward an event missing match context or failing validation', async () => {
    await controller.handleCommentary({ english: 'Four' } as never, context());
    await controller.handleCommentary({ ...payload, matchId: 'not-a-uuid' } as never, context());
    expect(gateway.broadcastCommentary).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

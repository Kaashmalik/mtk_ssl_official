import { ConfigService } from '@nestjs/config';
import { ConsumerIdempotencyService } from './consumer-idempotency.service';

const redisInstance = {
  set: jest.fn(),
  del: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => redisInstance),
}));

function service(redisUrl = 'redis://localhost:6379') {
  return new ConsumerIdempotencyService({ get: () => redisUrl } as unknown as ConfigService);
}

describe('Consumer idempotency claims (transport double, not real Redis)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisInstance.set.mockResolvedValue('OK');
    redisInstance.del.mockResolvedValue(1);
    redisInstance.quit.mockResolvedValue(undefined);
  });

  it('claims an unseen event with a namespaced key and bounded TTL', async () => {
    await expect(service().acquire('ball', 'event-1')).resolves.toBe('claimed');
    expect(redisInstance.set).toHaveBeenCalledWith(
      'consumed-commentary:ball:event-1',
      '1',
      'EX',
      86400,
      'NX',
    );
  });

  it('reports a duplicate claim for an already-consumed event', async () => {
    redisInstance.set.mockResolvedValue(null);
    await expect(service().acquire('intro', 'match:MatchStarted')).resolves.toBe('duplicate');
  });

  it('never invents a claim decision when the claim call fails', async () => {
    redisInstance.set.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service().acquire('ball', 'event-2')).resolves.toBe('unavailable');
  });

  it('exposes unavailability when Redis is not configured at all', async () => {
    await expect(service('').acquire('ball', 'event-3')).resolves.toBe('unavailable');
    expect(redisInstance.set).not.toHaveBeenCalled();
  });

  it('releases only its own namespaced claim so a redelivery reprocesses', async () => {
    await service().release('summary', 'match:MatchEnded');
    expect(redisInstance.del).toHaveBeenCalledWith('consumed-commentary:summary:match:MatchEnded');
  });

  it('degrades release failures to the TTL expiry instead of throwing', async () => {
    redisInstance.del.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service().release('ball', 'event-4')).resolves.toBeUndefined();
  });

  it('closes its connection cleanly on shutdown', async () => {
    await service().onModuleDestroy();
    expect(redisInstance.quit).toHaveBeenCalledTimes(1);
  });
});

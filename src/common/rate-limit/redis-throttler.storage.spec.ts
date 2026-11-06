import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service.js';
import {
  RATE_LIMIT_INCREMENT_LUA,
  RedisThrottlerStorage,
} from './redis-throttler.storage.js';

describe('RedisThrottlerStorage (unit)', () => {
  let redisService: { eval: ReturnType<typeof vi.fn> };
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    redisService = {
      eval: vi.fn(),
    };
    storage = new RedisThrottlerStorage(
      redisService as unknown as RedisService,
      new ConfigService({ RATE_LIMIT_FAIL_OPEN: 'true' }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes the atomic Lua script with hit/block keys and returns an unblocked record for hits 1..15', async () => {
    redisService.eval.mockResolvedValueOnce([1, 60_000, 0, 0]);

    const first = await storage.increment('test-key', 60_000, 15, 0, 'default');
    expect(redisService.eval).toHaveBeenCalledWith(
      RATE_LIMIT_INCREMENT_LUA,
      [
        'ecommerce:rl:default:test-key:hits',
        'ecommerce:rl:default:test-key:block',
      ],
      [60_000, 15, 0],
    );
    expect(first).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

    redisService.eval.mockResolvedValueOnce([15, 42_300, 0, 0]);
    const fifteenth = await storage.increment(
      'test-key',
      60_000,
      15,
      0,
      'default',
    );
    expect(fifteenth).toEqual({
      totalHits: 15,
      timeToExpire: 43,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('returns a blocked record with timeToBlockExpire in seconds on the 16th request', async () => {
    redisService.eval.mockResolvedValueOnce([16, 41_100, 1, 41_100]);

    const sixteenth = await storage.increment(
      'test-key',
      60_000,
      15,
      0,
      'default',
    );
    expect(sixteenth).toEqual({
      totalHits: 16,
      timeToExpire: 42,
      isBlocked: true,
      timeToBlockExpire: 42,
    });
  });

  it('fails open when Redis is unavailable or times out (default policy) and resumes when restored', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    redisService.eval.mockRejectedValueOnce(
      new Error('Redis connection unavailable (ECONNREFUSED)'),
    );
    const unavailableResult = await storage.increment(
      'test-key',
      60_000,
      15,
      0,
      'default',
    );
    expect(unavailableResult).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

    redisService.eval.mockRejectedValueOnce(new Error('Command timed out'));
    const timeoutResult = await storage.increment(
      'test-key',
      60_000,
      15,
      0,
      'default',
    );
    expect(timeoutResult.isBlocked).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    // Connection restored -> normal counting resumes
    redisService.eval.mockResolvedValueOnce([16, 30_000, 1, 30_000]);
    const restoredBlocked = await storage.increment(
      'test-key',
      60_000,
      15,
      0,
      'default',
    );
    expect(restoredBlocked).toEqual({
      totalHits: 16,
      timeToExpire: 30,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });

  it('rethrows Redis errors when RATE_LIMIT_FAIL_OPEN is false (fail-closed mode)', async () => {
    const failClosedStorage = new RedisThrottlerStorage(
      redisService as unknown as RedisService,
      new ConfigService({ RATE_LIMIT_FAIL_OPEN: 'false' }),
    );

    redisService.eval.mockRejectedValueOnce(new Error('Redis offline'));
    await expect(
      failClosedStorage.increment('test-key', 60_000, 15, 0, 'default'),
    ).rejects.toThrow('Redis offline');
  });
});

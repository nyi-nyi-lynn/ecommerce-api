import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { buildRedisOptions } from '../../redis/redis-config.js';
import { RedisService } from '../../redis/redis.service.js';
import {
  DEFAULT_DEVICE_METADATA_TTL_MS,
  DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
  DEFAULT_RATE_LIMIT_LIMIT,
  DEFAULT_RATE_LIMIT_TTL_MS,
  buildDeviceBlockedKey,
  buildDeviceMetadataKey,
  buildDeviceRequestsKey,
  resolveBlockDurationMs,
} from './rate-limit.constants.js';
import {
  RATE_LIMIT_DEVICE_LUA,
  RedisThrottlerStorage,
} from './redis-throttler.storage.js';

describe('RedisThrottlerStorage (unit)', () => {
  const DEVICE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const FIXED_NOW_MS = 1_700_000_000_000;

  let redisService: { eval: ReturnType<typeof vi.fn> };
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW_MS);

    redisService = {
      eval: vi.fn(),
    };
    storage = new RedisThrottlerStorage(
      redisService as unknown as RedisService,
      new ConfigService({ RATE_LIMIT_FAIL_OPEN: 'true' }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executes the atomic Lua script with device, requests, and blocked keys and plain-text IP', async () => {
    redisService.eval.mockResolvedValueOnce([1, 60_000, 0, 0, 0]);

    const first = await storage.increment(
      DEVICE_ID,
      DEFAULT_RATE_LIMIT_TTL_MS,
      DEFAULT_RATE_LIMIT_LIMIT,
      DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
      'default',
      '192.168.1.10',
    );

    expect(redisService.eval).toHaveBeenCalledWith(
      RATE_LIMIT_DEVICE_LUA,
      [
        `rate-limit:device:${DEVICE_ID}`,
        `rate-limit:requests:${DEVICE_ID}`,
        `rate-limit:blocked:${DEVICE_ID}`,
      ],
      [
        DEVICE_ID,
        '192.168.1.10',
        FIXED_NOW_MS,
        DEFAULT_RATE_LIMIT_TTL_MS,
        DEFAULT_RATE_LIMIT_LIMIT,
        DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
        DEFAULT_DEVICE_METADATA_TTL_MS,
      ],
    );
    expect(first).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('defaults block duration to 180 seconds (180,000ms) and supports environment overrides', async () => {
    expect(DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS).toBe(180_000);
    expect(resolveBlockDurationMs()).toBe(180_000);
    expect(
      resolveBlockDurationMs(
        new ConfigService({ RATE_LIMIT_BLOCK_DURATION_SECONDS: '300' }),
      ),
    ).toBe(300_000);
    expect(
      resolveBlockDurationMs(
        new ConfigService({ RATE_LIMIT_BLOCK_DURATION_MS: '240000' }),
      ),
    ).toBe(240_000);

    redisService.eval.mockResolvedValueOnce([
      16,
      60_000,
      1,
      180_000,
      FIXED_NOW_MS + 180_000,
    ]);

    const blocked = await storage.increment(
      DEVICE_ID,
      DEFAULT_RATE_LIMIT_TTL_MS,
      DEFAULT_RATE_LIMIT_LIMIT,
      0,
      'default',
      '192.168.1.10',
    );

    expect(redisService.eval).toHaveBeenCalledWith(
      RATE_LIMIT_DEVICE_LUA,
      [
        `rate-limit:device:${DEVICE_ID}`,
        `rate-limit:requests:${DEVICE_ID}`,
        `rate-limit:blocked:${DEVICE_ID}`,
      ],
      [
        DEVICE_ID,
        '192.168.1.10',
        FIXED_NOW_MS,
        60_000,
        15,
        180_000,
        DEFAULT_DEVICE_METADATA_TTL_MS,
      ],
    );
    expect(blocked).toEqual({
      totalHits: 16,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 180,
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
      DEVICE_ID,
      60_000,
      15,
      180_000,
      'default',
      '192.168.1.10',
    );
    expect(unavailableResult).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

    redisService.eval.mockRejectedValueOnce(new Error('Command timed out'));
    const timeoutResult = await storage.increment(
      DEVICE_ID,
      60_000,
      15,
      180_000,
      'default',
      '192.168.1.10',
    );
    expect(timeoutResult.isBlocked).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    redisService.eval.mockResolvedValueOnce([
      16,
      30_000,
      1,
      180_000,
      FIXED_NOW_MS + 180_000,
    ]);
    const restoredBlocked = await storage.increment(
      DEVICE_ID,
      60_000,
      15,
      180_000,
      'default',
      '192.168.1.10',
    );
    expect(restoredBlocked).toEqual({
      totalHits: 16,
      timeToExpire: 30,
      isBlocked: true,
      timeToBlockExpire: 180,
    });
  });

  it('rethrows Redis errors when RATE_LIMIT_FAIL_OPEN is false (fail-closed mode)', async () => {
    const failClosedStorage = new RedisThrottlerStorage(
      redisService as unknown as RedisService,
      new ConfigService({ RATE_LIMIT_FAIL_OPEN: 'false' }),
    );

    redisService.eval.mockRejectedValueOnce(new Error('Redis offline'));
    await expect(
      failClosedStorage.increment(
        DEVICE_ID,
        60_000,
        15,
        180_000,
        'default',
        '192.168.1.10',
      ),
    ).rejects.toThrow('Redis offline');
  });
});

describe('RedisThrottlerStorage (Real Redis Integration on 127.0.0.1:6379/db0)', () => {
  const RUN_PREFIX = `test-rl-it-${randomBytes(6).toString('hex')}`;
  const BASE_TIME_MS = 1_700_000_000_000;
  const createdRedisKeys = new Set<string>();

  let configService: ConfigService;
  let redisClient: Redis;
  let redisService: RedisService;
  let storage: RedisThrottlerStorage;

  function makeTestDeviceId(label: string): string {
    const id = `${RUN_PREFIX}:${label}`;
    createdRedisKeys.add(buildDeviceMetadataKey(id));
    createdRedisKeys.add(buildDeviceRequestsKey(id));
    createdRedisKeys.add(buildDeviceBlockedKey(id));
    return id;
  }

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: 6379,
      REDIS_DB: 0,
      RATE_LIMIT_FAIL_OPEN: 'false',
    });
    redisClient = new Redis(buildRedisOptions(configService));
    redisService = new RedisService(redisClient, configService);
    await redisService.onModuleInit();
    await redisService.checkConnectivity();
    storage = new RedisThrottlerStorage(redisService, configService);
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(BASE_TIME_MS);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (createdRedisKeys.size > 0) {
      await redisClient.del(...Array.from(createdRedisKeys));
      createdRedisKeys.clear();
    }
  });

  afterAll(async () => {
    if (createdRedisKeys.size > 0) {
      await redisClient.del(...Array.from(createdRedisKeys));
      createdRedisKeys.clear();
    }
    await redisService?. onModuleDestroy();
  });

  it('executes RATE_LIMIT_DEVICE_LUA on real Redis and writes metadata Hash, request Sorted Set, and TTLs', async () => {
    const deviceId = makeTestDeviceId('hash-and-zset');

    const first = await storage.increment(
      deviceId,
      DEFAULT_RATE_LIMIT_TTL_MS,
      DEFAULT_RATE_LIMIT_LIMIT,
      DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
      'default',
      '192.168.1.10',
    );
    expect(first).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

    vi.advanceTimersByTime(250);
    const second = await storage.increment(
      deviceId,
      DEFAULT_RATE_LIMIT_TTL_MS,
      DEFAULT_RATE_LIMIT_LIMIT,
      DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
      'default',
      '203.0.113.77',
    );
    expect(second.totalHits).toBe(2);
    expect(second.isBlocked).toBe(false);

    const deviceKey = buildDeviceMetadataKey(deviceId);
    const requestsKey = buildDeviceRequestsKey(deviceId);

    const metadata = await redisClient.hgetall(deviceKey);
    expect(metadata).toEqual({
      deviceId,
      ipAddress: '203.0.113.77',
      firstSeenAt: String(BASE_TIME_MS),
      lastSeenAt: String(BASE_TIME_MS + 250),
    });
    expect(await redisClient.pttl(deviceKey)).toBeGreaterThan(0);

    const zrangeWithScores = await redisClient.zrange(
      requestsKey,
      0,
      -1,
      'WITHSCORES',
    );
    expect(zrangeWithScores).toEqual([
      String(BASE_TIME_MS),
      String(BASE_TIME_MS),
      String(BASE_TIME_MS + 250),
      String(BASE_TIME_MS + 250),
    ]);
    expect(await redisClient.pttl(requestsKey)).toBeGreaterThan(0);

    // Advance past 60,000ms window so the first timestamp expires while the second remains
    vi.advanceTimersByTime(59_800);
    const third = await storage.increment(
      deviceId,
      DEFAULT_RATE_LIMIT_TTL_MS,
      DEFAULT_RATE_LIMIT_LIMIT,
      DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
      'default',
      '203.0.113.77',
    );
    expect(third.totalHits).toBe(2);

    const remainingMembers = await redisClient.zrange(requestsKey, 0, -1);
    expect(remainingMembers).toEqual([
      String(BASE_TIME_MS + 250),
      String(BASE_TIME_MS + 60_050),
    ]);
  });

  it('isolates different devices sharing the same IP address on real Redis', async () => {
    const sharedIp = '192.168.1.10';
    const deviceA = makeTestDeviceId('same-ip-device-a');
    const deviceB = makeTestDeviceId('same-ip-device-b');

    for (let i = 1; i <= 5; i++) {
      const res = await storage.increment(
        deviceA,
        60_000,
        5,
        DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
        'default',
        sharedIp,
      );
      expect(res.isBlocked).toBe(false);
      expect(res.totalHits).toBe(i);
    }

    const blockedA = await storage.increment(
      deviceA,
      60_000,
      5,
      DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
      'default',
      sharedIp,
    );
    expect(blockedA.isBlocked).toBe(true);
    expect(blockedA.timeToBlockExpire).toBe(180);

    const allowedB = await storage.increment(
      deviceB,
      60_000,
      5,
      DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
      'default',
      sharedIp,
    );
    expect(allowedB.isBlocked).toBe(false);
    expect(allowedB.totalHits).toBe(1);
    expect(await redisClient.get(buildDeviceBlockedKey(deviceB))).toBeNull();
  });

  it('enforces the 180s default block duration and allows requests after block expiration on real Redis', async () => {
    const deviceId = makeTestDeviceId('block-and-expire');
    const blockedKey = buildDeviceBlockedKey(deviceId);

    for (let i = 1; i <= 5; i++) {
      await storage.increment(deviceId, 60_000, 5, 0, 'default', '192.168.1.10');
    }

    // 6th request triggers default 180s block
    const sixth = await storage.increment(
      deviceId,
      60_000,
      5,
      0,
      'default',
      '192.168.1.10',
    );
    expect(sixth.isBlocked).toBe(true);
    expect(sixth.timeToBlockExpire).toBe(180);

    const storedBlockedUntil = await redisClient.get(blockedKey);
    expect(storedBlockedUntil).toBe(String(BASE_TIME_MS + 180_000));
    const blockPttl = await redisClient.pttl(blockedKey);
    expect(blockPttl).toBeGreaterThan(170_000);
    expect(blockPttl).toBeLessThanOrEqual(180_000);

    // Advance 120 seconds -> still blocked with 60s remaining
    vi.advanceTimersByTime(120_000);
    const stillBlocked = await storage.increment(
      deviceId,
      60_000,
      5,
      0,
      'default',
      '192.168.1.10',
    );
    expect(stillBlocked.isBlocked).toBe(true);
    expect(stillBlocked.timeToBlockExpire).toBe(60);

    // Advance past 180 seconds -> block expires and device can make requests again
    vi.advanceTimersByTime(60_001);
    const afterExpiry = await storage.increment(
      deviceId,
      60_000,
      5,
      0,
      'default',
      '192.168.1.10',
    );
    expect(afterExpiry.isBlocked).toBe(false);
    expect(afterExpiry.totalHits).toBe(1);
    expect(await redisClient.get(blockedKey)).toBeNull();
  });

  it('prevents concurrent requests from bypassing the threshold on real Redis', async () => {
    const deviceId = makeTestDeviceId('concurrent-burst');

    const totalConcurrent = 25;
    const limit = 15;
    const results = await Promise.all(
      Array.from({ length: totalConcurrent }, () =>
        storage.increment(
          deviceId,
          60_000,
          limit,
          DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
          'default',
          '192.168.1.10',
        ),
      ),
    );

    const allowed = results.filter((r) => !r.isBlocked);
    const blocked = results.filter((r) => r.isBlocked);

    expect(allowed).toHaveLength(15);
    expect(blocked).toHaveLength(10);
  });
});

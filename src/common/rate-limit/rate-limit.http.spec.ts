import {
  Controller,
  Get,
  Header,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { createTestHttpApp } from '../../../test/helpers/create-test-http-app.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RequirePermissions } from '../../rbac/permissions.decorator.js';
import { PermissionsGuard } from '../../rbac/permissions.guard.js';
import { RedisService } from '../../redis/redis.service.js';
import {
  DEFAULT_RATE_LIMIT_BLOCK_DURATION_SECONDS,
  DEVICE_ID_COOKIE_NAME,
  RATE_LIMIT_POLICIES,
  buildDeviceBlockedKey,
  buildDeviceMetadataKey,
  buildDeviceRequestsKey,
} from './rate-limit.constants.js';
import {
  RateLimitGuard,
  generateDeviceId,
  isValidDeviceId,
  parseCookieValue,
} from './rate-limit.guard.js';
import { RateLimitModule } from './rate-limit.module.js';

@Controller('rate-limit-test')
class RateLimitTestController {
  @Get('items')
  @Header('X-Endpoint-Version', 'v1')
  getItems() {
    return { items: ['alpha', 'beta'] };
  }

  @Post('strict-login')
  @Throttle(RATE_LIMIT_POLICIES.AUTH_STRICT)
  strictLogin() {
    return { ok: true };
  }

  @Get('health')
  @SkipThrottle()
  health() {
    return { status: 'ok' };
  }

  @Get('protected-orders')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('order:read')
  protectedOrders(@CurrentUser('sub') userId: string) {
    return { userId, orders: [] };
  }
}

interface SimulatedHashEntry {
  fields: Record<string, string>;
  expiresAt: number;
}

interface SimulatedZSetMember {
  member: string;
  score: number;
}

interface SimulatedZSetEntry {
  members: Map<string, number>;
  expiresAt: number;
}

interface SimulatedStringEntry {
  value: string;
  expiresAt: number;
}

/**
 * Simulates Redis single-threaded atomic Lua execution for RATE_LIMIT_DEVICE_LUA:
 * - Hash `rate-limit:device:<DEVICE_ID>`
 * - Sorted Set `rate-limit:requests:<DEVICE_ID>`
 * - String `rate-limit:blocked:<DEVICE_ID>`
 */
class AtomicRedisSimulator {
  private readonly hashes = new Map<string, SimulatedHashEntry>();
  private readonly zsets = new Map<string, SimulatedZSetEntry>();
  private readonly strings = new Map<string, SimulatedStringEntry>();
  public failNextWith: Error | null = null;

  private getNowMs(argNowMs?: number): number {
    return typeof argNowMs === 'number' && Number.isFinite(argNowMs)
      ? argNowMs
      : Date.now();
  }

  private getActiveHash(
    key: string,
    nowMs: number,
  ): SimulatedHashEntry | undefined {
    const entry = this.hashes.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      this.hashes.delete(key);
      return undefined;
    }
    return entry;
  }

  private getActiveZSet(
    key: string,
    nowMs: number,
  ): SimulatedZSetEntry | undefined {
    const entry = this.zsets.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      this.zsets.delete(key);
      return undefined;
    }
    return entry;
  }

  private getActiveString(
    key: string,
    nowMs: number,
  ): SimulatedStringEntry | undefined {
    const entry = this.strings.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      this.strings.delete(key);
      return undefined;
    }
    return entry;
  }

  public getDeviceMetadata(deviceId: string): {
    fields: Record<string, string>;
    ttlMs: number;
  } | null {
    const nowMs = Date.now();
    const entry = this.getActiveHash(buildDeviceMetadataKey(deviceId), nowMs);
    if (!entry) return null;
    return {
      fields: { ...entry.fields },
      ttlMs: Math.max(0, entry.expiresAt - nowMs),
    };
  }

  public getRequestHistory(deviceId: string): {
    entries: SimulatedZSetMember[];
    ttlMs: number;
  } | null {
    const nowMs = Date.now();
    const entry = this.getActiveZSet(buildDeviceRequestsKey(deviceId), nowMs);
    if (!entry) return null;
    const entries = Array.from(entry.members.entries())
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
    return {
      entries,
      ttlMs: Math.max(0, entry.expiresAt - nowMs),
    };
  }

  public getBlockRecord(deviceId: string): {
    value: string;
    blockedUntilMs: number;
    ttlMs: number;
  } | null {
    const nowMs = Date.now();
    const entry = this.getActiveString(buildDeviceBlockedKey(deviceId), nowMs);
    if (!entry) return null;
    return {
      value: entry.value,
      blockedUntilMs: Number(entry.value),
      ttlMs: Math.max(0, entry.expiresAt - nowMs),
    };
  }

  eval = vi.fn(
    async (
      _script: string,
      keys: string[],
      args: Array<string | number>,
    ): Promise<[number, number, number, number, number]> => {
      if (this.failNextWith) {
        const err = this.failNextWith;
        this.failNextWith = null;
        throw err;
      }

      const [deviceKey, requestsKey, blockedKey] = keys;
      const deviceId = String(args[0]);
      const ipAddress = String(args[1]);
      const nowMs = this.getNowMs(Number(args[2]));
      const windowMs = Number(args[3]);
      const limit = Number(args[4]);
      const blockDurationMs = Number(args[5]);
      const deviceTtlMs = Number(args[6]);

      // 1. Update device metadata in Redis Hash
      let hashEntry = this.getActiveHash(deviceKey, nowMs);
      if (!hashEntry) {
        hashEntry = {
          fields: {
            firstSeenAt: String(nowMs),
          },
          expiresAt: nowMs + deviceTtlMs,
        };
        this.hashes.set(deviceKey, hashEntry);
      } else if (hashEntry.fields.firstSeenAt === undefined) {
        hashEntry.fields.firstSeenAt = String(nowMs);
      }
      hashEntry.fields.deviceId = deviceId;
      hashEntry.fields.ipAddress = ipAddress;
      hashEntry.fields.lastSeenAt = String(nowMs);
      hashEntry.expiresAt = nowMs + deviceTtlMs;

      // 2. Check whether this device is currently blocked
      const blockEntry = this.getActiveString(blockedKey, nowMs);
      if (blockEntry) {
        const blockedUntilMs = Number(blockEntry.value);
        const remainingBlockMs = Number.isFinite(blockedUntilMs)
          ? blockedUntilMs - nowMs
          : blockEntry.expiresAt - nowMs;
        if (remainingBlockMs > 0) {
          const zset = this.getActiveZSet(requestsKey, nowMs);
          const currentHits = zset ? zset.members.size : 0;
          return [
            currentHits,
            remainingBlockMs,
            1,
            remainingBlockMs,
            blockedUntilMs,
          ];
        }
        this.strings.delete(blockedKey);
      }

      // 3. Remove expired request timestamps (score <= nowMs - windowMs)
      const minScore = nowMs - windowMs;
      let zsetEntry = this.getActiveZSet(requestsKey, nowMs);
      if (!zsetEntry) {
        zsetEntry = {
          members: new Map<string, number>(),
          expiresAt: nowMs + windowMs,
        };
        this.zsets.set(requestsKey, zsetEntry);
      } else {
        for (const [member, score] of zsetEntry.members.entries()) {
          if (score <= minScore) {
            zsetEntry.members.delete(member);
          }
        }
      }

      // 4. Add the current request timestamp in milliseconds
      let member = String(nowMs);
      let suffix = 1;
      while (zsetEntry.members.has(member)) {
        suffix += 1;
        member = `${nowMs}:${suffix}`;
      }
      zsetEntry.members.set(member, nowMs);
      zsetEntry.expiresAt = nowMs + windowMs;

      // 5. Count requests inside the window
      const totalHits = zsetEntry.members.size;
      const scores = Array.from(zsetEntry.members.values()).sort(
        (a, b) => a - b,
      );
      const oldestTimestampMs = scores[0] ?? nowMs;
      const windowRemainingMs = Math.max(
        1,
        oldestTimestampMs + windowMs - nowMs,
      );

      // 6. Apply the rate-limit threshold
      if (totalHits > limit) {
        const effectiveBlockMs =
          blockDurationMs > 0 ? blockDurationMs : windowMs;
        const blockedUntilMs = nowMs + effectiveBlockMs;
        this.strings.set(blockedKey, {
          value: String(blockedUntilMs),
          expiresAt: blockedUntilMs,
        });
        if (effectiveBlockMs < windowMs) {
          zsetEntry.expiresAt = nowMs + effectiveBlockMs;
        }
        if (effectiveBlockMs > deviceTtlMs) {
          hashEntry.expiresAt = nowMs + effectiveBlockMs;
        }
        return [
          totalHits,
          windowRemainingMs,
          1,
          effectiveBlockMs,
          blockedUntilMs,
        ];
      }

      return [totalHits, windowRemainingMs, 0, 0, 0];
    },
  );
}

const USER_1 = '550e8400-e29b-41d4-a716-446655440001';
const USER_NO_PERM = '550e8400-e29b-41d4-a716-446655440003';

function extractIssuedDeviceId(res: request.Response): string | undefined {
  const rawSetCookie = res.headers['set-cookie'];
  const cookieList = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : typeof rawSetCookie === 'string'
      ? [rawSetCookie]
      : [];
  for (const header of cookieList) {
    const value = parseCookieValue(header, DEVICE_ID_COOKIE_NAME);
    if (value) {
      return value;
    }
  }
  return undefined;
}

async function createRateLimitedApp(
  redisSimulator: AtomicRedisSimulator,
  options?: {
    trustProxy?: boolean | number;
    failOpen?: boolean;
    onDestroySpy?: ReturnType<typeof vi.fn>;
  },
): Promise<INestApplication> {
  const failOpenValue = options?.failOpen ?? true;
  const app = await createTestHttpApp({
    imports: [
      JwtModule.register({ secret: 'rate-limit-test-jwt-secret' }),
      RateLimitModule,
    ],
    controllers: [RateLimitTestController],
    providers: [
      Reflector,
      JwtAuthGuard,
      PermissionsGuard,
      {
        provide: PrismaService,
        useValue: {
          user: {
            findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
              isActive: true,
              role: {
                permissions:
                  where.id === USER_1
                    ? [{ permission: { code: 'order:read' } }]
                    : [],
              },
            })),
          },
        },
      },
      { provide: APP_GUARD, useClass: RateLimitGuard },
    ],
    customizeBuilder: (builder) =>
      builder
        .overrideProvider(ConfigService)
        .useValue(
          new ConfigService({
            RATE_LIMIT_FAIL_OPEN: String(failOpenValue),
          }),
        )
        .overrideProvider(RedisService)
        .useValue({
          onModuleInit: vi.fn().mockResolvedValue(undefined),
          onModuleDestroy:
            options?.onDestroySpy ?? vi.fn().mockResolvedValue(undefined),
          eval: redisSimulator.eval,
        }),
  });

  if (options?.trustProxy !== undefined) {
    app.getHttpAdapter().getInstance().set('trust proxy', options.trustProxy);
  }

  return app;
}

describe('Device-Based Rate Limiting HTTP Integration', () => {
  const INITIAL_TIME_MS = 1_700_000_000_000;
  let redisSimulator: AtomicRedisSimulator;
  let app: INestApplication;
  let jwtService: JwtService;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INITIAL_TIME_MS);

    redisSimulator = new AtomicRedisSimulator();
    app = await createRateLimitedApp(redisSimulator, { trustProxy: 1 });
    jwtService = app.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
    vi.useRealTimers();
  });

  describe('Test A: Same Device', () => {
    it('reuses the same device cookie, uses the same Redis keys, and accumulates millisecond timestamps in a Sorted Set', async () => {
      const firstRes = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('X-Forwarded-For', '192.168.1.10')
        .expect(200);

      const deviceId = extractIssuedDeviceId(firstRes);
      expect(deviceId).toBeDefined();
      expect(isValidDeviceId(deviceId)).toBe(true);
      expect(firstRes.headers['x-ratelimit-limit']).toBe('15');
      expect(firstRes.headers['x-ratelimit-remaining']).toBe('14');

      const cookieHeader = `${DEVICE_ID_COOKIE_NAME}=${deviceId}`;

      vi.advanceTimersByTime(150);
      const secondRes = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookieHeader)
        .set('X-Forwarded-For', '192.168.1.10')
        .expect(200);

      // Existing valid cookie is reused without issuing a replacement cookie
      expect(extractIssuedDeviceId(secondRes)).toBeUndefined();
      expect(secondRes.headers['x-ratelimit-remaining']).toBe('13');

      vi.advanceTimersByTime(250);
      const thirdRes = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookieHeader)
        .set('X-Forwarded-For', '192.168.1.10')
        .expect(200);

      expect(thirdRes.headers['x-ratelimit-remaining']).toBe('12');

      const history = redisSimulator.getRequestHistory(deviceId!);
      expect(history).not.toBeNull();
      expect(history!.entries).toEqual([
        { member: String(INITIAL_TIME_MS), score: INITIAL_TIME_MS },
        {
          member: String(INITIAL_TIME_MS + 150),
          score: INITIAL_TIME_MS + 150,
        },
        {
          member: String(INITIAL_TIME_MS + 400),
          score: INITIAL_TIME_MS + 400,
        },
      ]);
      expect(history!.ttlMs).toBeGreaterThan(0);

      const metadata = redisSimulator.getDeviceMetadata(deviceId!);
      expect(metadata).not.toBeNull();
      expect(metadata!.fields).toEqual({
        deviceId: deviceId!,
        ipAddress: '192.168.1.10',
        firstSeenAt: String(INITIAL_TIME_MS),
        lastSeenAt: String(INITIAL_TIME_MS + 400),
      });
    });
  });

  describe('Test B: Different Devices, Same IP', () => {
    it('isolates Device A, Device B, and Device C sharing Wi-Fi IP 192.168.1.10 so blocking Device A never blocks B or C', async () => {
      const sharedWifiIp = '192.168.1.10';
      const deviceA = generateDeviceId();
      const deviceB = generateDeviceId();
      const deviceC = generateDeviceId();

      const cookieA = `${DEVICE_ID_COOKIE_NAME}=${deviceA}`;
      const cookieB = `${DEVICE_ID_COOKIE_NAME}=${deviceB}`;
      const cookieC = `${DEVICE_ID_COOKIE_NAME}=${deviceC}`;

      // Device A makes 15 allowed requests
      for (let i = 1; i <= 15; i++) {
        vi.advanceTimersByTime(10);
        await request(app.getHttpServer())
          .get('/api/rate-limit-test/items')
          .set('Cookie', cookieA)
          .set('X-Forwarded-For', sharedWifiIp)
          .expect(200);
      }

      // 16th request from Device A exceeds the limit and blocks Device A
      vi.advanceTimersByTime(10);
      const blockedA = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookieA)
        .set('X-Forwarded-For', sharedWifiIp)
        .expect(429);

      expect(blockedA.headers['retry-after']).toBe('180');
      expect(redisSimulator.getBlockRecord(deviceA)).not.toBeNull();

      // Device B on the exact same IP 192.168.1.10 remains completely unblocked
      const resB = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookieB)
        .set('X-Forwarded-For', sharedWifiIp)
        .expect(200);

      expect(resB.headers['x-ratelimit-remaining']).toBe('14');
      expect(redisSimulator.getBlockRecord(deviceB)).toBeNull();
      expect(redisSimulator.getRequestHistory(deviceB)?.entries).toHaveLength(
        1,
      );

      // Device C on the exact same IP 192.168.1.10 also remains completely unblocked
      const resC = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookieC)
        .set('X-Forwarded-For', sharedWifiIp)
        .expect(200);

      expect(resC.headers['x-ratelimit-remaining']).toBe('14');
      expect(redisSimulator.getBlockRecord(deviceC)).toBeNull();
      expect(redisSimulator.getRequestHistory(deviceC)?.entries).toHaveLength(
        1,
      );

      // Device A is still blocked while B and C continue making requests
      await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookieA)
        .set('X-Forwarded-For', sharedWifiIp)
        .expect(429);
    });
  });

  describe('Test C: Same Device, Different IP', () => {
    it('preserves the same device rate-limit identity when IP changes and updates Redis metadata with the latest IP', async () => {
      const deviceId = generateDeviceId();
      const cookie = `${DEVICE_ID_COOKIE_NAME}=${deviceId}`;

      await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', '192.168.1.10')
        .expect(200);

      expect(redisSimulator.getDeviceMetadata(deviceId)?.fields).toEqual({
        deviceId,
        ipAddress: '192.168.1.10',
        firstSeenAt: String(INITIAL_TIME_MS),
        lastSeenAt: String(INITIAL_TIME_MS),
      });

      // Same device switches network to a new IP address
      vi.advanceTimersByTime(5_000);
      const secondRes = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', '203.0.113.55')
        .expect(200);

      expect(secondRes.headers['x-ratelimit-remaining']).toBe('13');
      expect(redisSimulator.getRequestHistory(deviceId)?.entries).toHaveLength(
        2,
      );
      expect(redisSimulator.getDeviceMetadata(deviceId)?.fields).toEqual({
        deviceId,
        ipAddress: '203.0.113.55',
        firstSeenAt: String(INITIAL_TIME_MS),
        lastSeenAt: String(INITIAL_TIME_MS + 5_000),
      });
    });
  });

  describe('Test D: Actual IP Storage', () => {
    it('stores the actual client IP in Redis Hash metadata as readable plain text (not encrypted or hashed) and respects trust proxy', async () => {
      const deviceId = generateDeviceId();
      const cookie = `${DEVICE_ID_COOKIE_NAME}=${deviceId}`;

      await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookie)
        .set('X-Forwarded-For', '198.51.100.42')
        .expect(200);

      const metadata = redisSimulator.getDeviceMetadata(deviceId);
      expect(metadata).not.toBeNull();
      expect(metadata!.fields.ipAddress).toBe('198.51.100.42');
      expect(metadata!.ttlMs).toBeGreaterThan(0);

      // When trust proxy is disabled, spoofed X-Forwarded-For is ignored and socket IP (127.0.0.1) is stored in plain text
      const untrustedProxyApp = await createRateLimitedApp(redisSimulator, {
        trustProxy: false,
      });
      try {
        const directDeviceId = generateDeviceId();
        await request(untrustedProxyApp.getHttpServer())
          .get('/api/rate-limit-test/items')
          .set('Cookie', `${DEVICE_ID_COOKIE_NAME}=${directDeviceId}`)
          .set('X-Forwarded-For', '1.2.3.4')
          .expect(200);

        const directMetadata =
          redisSimulator.getDeviceMetadata(directDeviceId);
        expect(directMetadata?.fields.ipAddress).toBe('127.0.0.1');
      } finally {
        await untrustedProxyApp.close();
      }
    });
  });

  describe('Test E: Missing or Invalid Device Cookie', () => {
    it('issues a valid new device ID when cookie is missing or malformed and ignores arbitrary header/query IDs', async () => {
      // 1. Missing cookie
      const missingRes = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(200);

      const issuedFromMissing = extractIssuedDeviceId(missingRes);
      expect(isValidDeviceId(issuedFromMissing)).toBe(true);
      expect(String(missingRes.headers['set-cookie'])).toContain('HttpOnly');
      expect(String(missingRes.headers['set-cookie'])).toContain(
        'SameSite=Lax',
      );

      // 2. Malformed cookie values + spoofed header/query attempts
      const spoofedHeaderDeviceId = generateDeviceId();
      const malformedRes = await request(app.getHttpServer())
        .get(`/api/rate-limit-test/items?deviceId=${spoofedHeaderDeviceId}`)
        .set('Cookie', `${DEVICE_ID_COOKIE_NAME}=invalid-malformed-id-123`)
        .set('X-Device-Id', spoofedHeaderDeviceId)
        .expect(200);

      const issuedFromMalformed = extractIssuedDeviceId(malformedRes);
      expect(isValidDeviceId(issuedFromMalformed)).toBe(true);
      expect(issuedFromMalformed).not.toBe('invalid-malformed-id-123');
      expect(issuedFromMalformed).not.toBe(spoofedHeaderDeviceId);
      expect(
        redisSimulator.getDeviceMetadata('invalid-malformed-id-123'),
      ).toBeNull();
      expect(
        redisSimulator.getDeviceMetadata(spoofedHeaderDeviceId),
      ).toBeNull();
      expect(
        redisSimulator.getDeviceMetadata(issuedFromMalformed!),
      ).not.toBeNull();
    });
  });

  describe('Test F & Test G: Default 180s Block Duration and Expired Block Recovery', () => {
    it('blocks a device for 180 seconds by default, stores block expiration timestamp in Redis, and allows requests after expiry', async () => {
      expect(DEFAULT_RATE_LIMIT_BLOCK_DURATION_SECONDS).toBe(180);

      const deviceId = generateDeviceId();
      const cookie = `${DEVICE_ID_COOKIE_NAME}=${deviceId}`;

      for (let i = 1; i <= 15; i++) {
        await request(app.getHttpServer())
          .get('/api/rate-limit-test/items')
          .set('Cookie', cookie)
          .expect(200);
      }

      // 16th request triggers a 180-second block
      const blockedRes = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookie)
        .expect(429);

      expect(blockedRes.headers['retry-after']).toBe('180');
      const blockRecord = redisSimulator.getBlockRecord(deviceId);
      expect(blockRecord).not.toBeNull();
      expect(blockRecord!.blockedUntilMs).toBe(INITIAL_TIME_MS + 180_000);
      expect(blockRecord!.ttlMs).toBe(180_000);

      // Advance clock by 60 seconds (window duration) -> still blocked for 120 more seconds!
      vi.advanceTimersByTime(60_000);
      const blockedAt60s = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookie)
        .expect(429);
      expect(blockedAt60s.headers['retry-after']).toBe('120');

      // Advance clock by another 119,000ms (179s total) -> 1 second remaining
      vi.advanceTimersByTime(119_000);
      const blockedAt179s = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookie)
        .expect(429);
      expect(blockedAt179s.headers['retry-after']).toBe('1');

      // Advance clock past 180 seconds (180,001ms total) -> block expires and device is allowed again
      vi.advanceTimersByTime(1_001);
      const allowedAgain = await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('Cookie', cookie)
        .expect(200);

      expect(allowedAgain.body.success).toBe(true);
      expect(allowedAgain.headers['x-ratelimit-remaining']).toBe('14');
      expect(redisSimulator.getBlockRecord(deviceId)).toBeNull();
    });
  });

  describe('Test H: Concurrent Requests', () => {
    it('prevents concurrent requests from the same device from bypassing the threshold', async () => {
      await app.listen(0);
      const deviceId = generateDeviceId();
      const cookie = `${DEVICE_ID_COOKIE_NAME}=${deviceId}`;

      const totalConcurrent = 25;
      const responses = await Promise.all(
        Array.from({ length: totalConcurrent }, () =>
          request(app.getHttpServer())
            .get('/api/rate-limit-test/items')
            .set('Cookie', cookie)
            .set('X-Forwarded-For', '192.168.1.10'),
        ),
      );

      const allowed = responses.filter((res) => res.status === 200);
      const blocked = responses.filter((res) => res.status === 429);

      expect(allowed).toHaveLength(15);
      expect(blocked).toHaveLength(10);
      for (const res of blocked) {
        expect(res.body).toMatchObject({
          success: false,
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Too many requests. Please try again later.',
        });
        expect(res.headers['retry-after']).toBe('180');
      }
    });
  });

  describe('Test I: Existing Behavior (Decorators, Protected Endpoints, Error Envelope, Fail-Open/Closed)', () => {
    it('enforces @Throttle overrides and @SkipThrottle exemptions', async () => {
      const deviceId = generateDeviceId();
      const cookie = `${DEVICE_ID_COOKIE_NAME}=${deviceId}`;

      // @Throttle(RATE_LIMIT_POLICIES.AUTH_STRICT) -> limit of 5 requests per 60s
      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/rate-limit-test/strict-login')
          .set('Cookie', cookie)
          .expect(201);
        expect(res.headers['x-ratelimit-limit']).toBe('5');
        expect(res.headers['x-ratelimit-remaining']).toBe(String(5 - i));
      }

      // 6th request is blocked with 429 and 180s Retry-After
      const blockedStrict = await request(app.getHttpServer())
        .post('/api/rate-limit-test/strict-login')
        .set('Cookie', cookie)
        .expect(429);
      expect(blockedStrict.headers['retry-after']).toBe('180');
      expect(blockedStrict.body).toMatchObject({
        success: false,
        statusCode: 429,
        message: 'Too many requests. Please try again later.',
        error: 'Too Many Requests',
        path: '/api/rate-limit-test/strict-login',
      });

      // @SkipThrottle() -> health endpoint is never throttled
      const evalCallsBeforeHealth = redisSimulator.eval.mock.calls.length;
      for (let i = 1; i <= 20; i++) {
        await request(app.getHttpServer())
          .get('/api/rate-limit-test/health')
          .set('Cookie', cookie)
          .expect(200);
      }
      expect(redisSimulator.eval.mock.calls.length).toBe(evalCallsBeforeHealth);
    });

    it('preserves JwtAuthGuard (401) and PermissionsGuard (403) without treating device ID as an auth credential', async () => {
      const tokenUser1 = await jwtService.signAsync({
        sub: USER_1,
        email: 'u1@example.com',
        role: 'CUSTOMER',
      });
      const tokenNoPerm = await jwtService.signAsync({
        sub: USER_NO_PERM,
        email: 'noperm@example.com',
        role: 'CUSTOMER',
      });

      const deviceId = generateDeviceId();
      const cookie = `${DEVICE_ID_COOKIE_NAME}=${deviceId}`;

      // Valid device cookie without Bearer token still receives 401 Unauthorized
      await request(app.getHttpServer())
        .get('/api/rate-limit-test/protected-orders')
        .set('Cookie', cookie)
        .expect(401);

      // Valid device cookie + user without permission still receives 403 Forbidden
      await request(app.getHttpServer())
        .get('/api/rate-limit-test/protected-orders')
        .set('Cookie', cookie)
        .set('Authorization', `Bearer ${tokenNoPerm}`)
        .expect(403);

      // Valid device cookie + authorized user succeeds with 200 OK
      const authorizedRes = await request(app.getHttpServer())
        .get('/api/rate-limit-test/protected-orders')
        .set('Cookie', cookie)
        .set('Authorization', `Bearer ${tokenUser1}`)
        .expect(200);
      expect(authorizedRes.body.data).toEqual({
        userId: USER_1,
        orders: [],
      });
    });

    it('fails open when Redis is unavailable and hides internal errors when fail-closed', async () => {
      const onDestroySpy = vi.fn().mockResolvedValue(undefined);
      const resilientApp = await createRateLimitedApp(redisSimulator, {
        failOpen: true,
        onDestroySpy,
      });

      try {
        redisSimulator.failNextWith = new Error(
          'Redis ECONNREFUSED 127.0.0.1:6379',
        );
        await request(resilientApp.getHttpServer())
          .get('/api/rate-limit-test/items')
          .expect(200);
      } finally {
        await resilientApp.close();
        expect(onDestroySpy).toHaveBeenCalledOnce();
      }

      const failClosedApp = await createRateLimitedApp(redisSimulator, {
        failOpen: false,
      });
      try {
        redisSimulator.failNextWith = new Error(
          'Redis cluster ECONNREFUSED 127.0.0.1:6379 internal detail',
        );
        const res = await request(failClosedApp.getHttpServer())
          .get('/api/rate-limit-test/items')
          .expect(500);
        expect(res.body).toMatchObject({
          success: false,
          statusCode: 500,
          message: 'Internal server error',
          error: 'Internal Server Error',
        });
        expect(JSON.stringify(res.body)).not.toMatch(/Redis|ECONNREFUSED/i);
      } finally {
        await failClosedApp.close();
      }
    });
  });
});

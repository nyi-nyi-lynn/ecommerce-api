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
import { RATE_LIMIT_POLICIES } from './rate-limit.constants.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimitModule } from './rate-limit.module.js';

@Controller('rate-limit-test')
class RateLimitTestController {
  @Get('items')
  @Header('X-Endpoint-Version', 'v1')
  getItems() {
    return { items: ['alpha', 'beta'] };
  }

  @Post('items')
  createItem() {
    return { created: true };
  }

  @Get('other')
  getOther() {
    return { section: 'other' };
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

interface SimulatedRedisEntry {
  value: number;
  expiresAt: number;
}

/**
 * Simulates Redis single-threaded atomic Lua execution for RATE_LIMIT_INCREMENT_LUA
 * with controllable clock `nowMs` so tests can deterministically advance the 60s window
 * and share state across multiple application instances.
 */
class AtomicRedisSimulator {
  private readonly store = new Map<string, SimulatedRedisEntry>();
  public nowMs = 1_700_000_000_000;
  public failNextWith: Error | null = null;

  private pttl(key: string): number {
    const entry = this.store.get(key);
    if (!entry) return -2;
    const remaining = entry.expiresAt - this.nowMs;
    if (remaining <= 0) {
      this.store.delete(key);
      return -2;
    }
    return remaining;
  }

  private incr(key: string): number {
    const remaining = this.pttl(key);
    if (remaining === -2) {
      this.store.set(key, { value: 1, expiresAt: Infinity });
      return 1;
    }
    const entry = this.store.get(key)!;
    entry.value += 1;
    return entry.value;
  }

  private pexpire(key: string, ttlMs: number): void {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = this.nowMs + ttlMs;
    }
  }

  eval = vi.fn(
    async (
      _script: string,
      keys: string[],
      args: Array<string | number>,
    ): Promise<[number, number, number, number]> => {
      if (this.failNextWith) {
        const err = this.failNextWith;
        this.failNextWith = null;
        throw err;
      }

      const [hitKey, blockKey] = keys;
      const ttl = Number(args[0]);
      const limit = Number(args[1]);
      const blockDuration = Number(args[2]);

      const blockTtl = this.pttl(blockKey);
      if (blockTtl > 0) {
        const hits = this.incr(hitKey);
        let hitTtl = this.pttl(hitKey);
        if (hitTtl < 0) {
          this.pexpire(hitKey, blockTtl);
          hitTtl = blockTtl;
        }
        return [hits, hitTtl, 1, blockTtl];
      }

      const hits = this.incr(hitKey);
      let hitTtl = this.pttl(hitKey);
      if (hits === 1 || hitTtl < 0 || !Number.isFinite(hitTtl)) {
        this.pexpire(hitKey, ttl);
        hitTtl = ttl;
      }

      if (hits > limit) {
        if (blockDuration > ttl) {
          if (this.pttl(blockKey) < 0) {
            this.store.set(blockKey, {
              value: 1,
              expiresAt: this.nowMs + blockDuration,
            });
          }
          const currentBlockTtl = this.pttl(blockKey);
          return [
            hits,
            hitTtl,
            1,
            currentBlockTtl > 0 ? currentBlockTtl : blockDuration,
          ];
        }
        return [hits, hitTtl, 1, hitTtl];
      }

      return [hits, hitTtl, 0, 0];
    },
  );
}

const USER_1 = '550e8400-e29b-41d4-a716-446655440001';
const USER_2 = '550e8400-e29b-41d4-a716-446655440002';
const USER_NO_PERM = '550e8400-e29b-41d4-a716-446655440003';

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
                  where.id === USER_1 || where.id === USER_2
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

describe('Global & Custom Rate Limiting HTTP Integration (Phases 3 & 4)', () => {
  let redisSimulator: AtomicRedisSimulator;
  let app: INestApplication;
  let jwtService: JwtService;

  beforeEach(async () => {
    redisSimulator = new AtomicRedisSimulator();
    app = await createRateLimitedApp(redisSimulator);
    jwtService = app.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('allows request 1 through 15 and blocks request 16 with HTTP 429, Retry-After header, and global ErrorEnvelope', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(200);

    expect(first.body).toMatchObject({
      success: true,
      data: { items: ['alpha', 'beta'] },
      path: '/api/rate-limit-test/items',
    });
    expect(first.headers['x-ratelimit-limit']).toBe('15');
    expect(first.headers['x-ratelimit-remaining']).toBe('14');
    expect(first.headers['x-ratelimit-reset']).toBe('60');

    for (let i = 2; i <= 14; i++) {
      await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(200);
    }

    const fifteenth = await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(200);

    expect(fifteenth.body.success).toBe(true);
    expect(fifteenth.headers['x-ratelimit-limit']).toBe('15');
    expect(fifteenth.headers['x-ratelimit-remaining']).toBe('0');

    const sixteenth = await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(429);

    expect(sixteenth.headers['retry-after']).toBe('60');
    expect(sixteenth.body).toMatchObject({
      success: false,
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      error: 'Too Many Requests',
      path: '/api/rate-limit-test/items',
    });
    expect(Number.isNaN(Date.parse(sixteenth.body.timestamp))).toBe(false);
  });

  it('allows requests again after the configured 60,000ms window expires and updates Retry-After to actual remaining wait time', async () => {
    for (let i = 1; i <= 15; i++) {
      await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(200);
    }

    await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(429);

    // Advance clock by 25,000ms -> 35 seconds remaining in the 60s window
    redisSimulator.nowMs += 25_000;
    const midWindowBlocked = await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(429);
    expect(midWindowBlocked.headers['retry-after']).toBe('35');
    expect(midWindowBlocked.body.message).toBe(
      'Too many requests. Please try again later.',
    );

    // Advance clock by another 34,999ms (59,999ms total) -> 1 second remaining
    redisSimulator.nowMs += 34_999;
    const stillBlocked = await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(429);
    expect(stillBlocked.headers['retry-after']).toBe('1');

    redisSimulator.nowMs += 2;
    const allowedAgain = await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(200);

    expect(allowedAgain.body.success).toBe(true);
    expect(allowedAgain.headers['x-ratelimit-remaining']).toBe('14');
    expect(allowedAgain.headers['x-endpoint-version']).toBe('v1');
  });

  it('shares counters across multiple application instances connected to the same Redis', async () => {
    const secondApp = await createRateLimitedApp(redisSimulator);

    try {
      for (let i = 1; i <= 8; i++) {
        await request(app.getHttpServer())
          .get('/api/rate-limit-test/items')
          .expect(200);
      }

      for (let i = 9; i <= 15; i++) {
        const res = await request(secondApp.getHttpServer())
          .get('/api/rate-limit-test/items')
          .expect(200);
        if (i === 15) {
          expect(res.headers['x-ratelimit-remaining']).toBe('0');
        }
      }

      await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(429);

      await request(secondApp.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(429);
    } finally {
      await secondApp.close();
    }
  });

  it('enforces the exact limit of 15 under concurrent request bursts', async () => {
    await app.listen(0);
    const totalConcurrent = 25;
    const responses = await Promise.all(
      Array.from({ length: totalConcurrent }, () =>
        request(app.getHttpServer()).get('/api/rate-limit-test/items'),
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
      });
      expect(res.headers['retry-after']).toBeDefined();
    }
  });

  it('fails open when Redis is unavailable or times out, resumes counting when restored, and closes cleanly on shutdown', async () => {
    const onDestroySpy = vi.fn().mockResolvedValue(undefined);
    const resilientApp = await createRateLimitedApp(redisSimulator, {
      failOpen: true,
      onDestroySpy,
    });

    try {
      // 1. Redis connection unavailable -> fails open (200 OK)
      redisSimulator.failNextWith = new Error(
        'Redis ECONNREFUSED 127.0.0.1:6379',
      );
      await request(resilientApp.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(200);

      // 2. Redis operation timeout -> fails open (200 OK)
      redisSimulator.failNextWith = new Error('Command timed out');
      await request(resilientApp.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(200);

      // 3. Redis connection restored -> normal counting resumes (1..15 allowed, 16th blocked)
      for (let i = 1; i <= 15; i++) {
        await request(resilientApp.getHttpServer())
          .get('/api/rate-limit-test/items')
          .expect(200);
      }
      await request(resilientApp.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(429);
    } finally {
      // 4. Graceful application shutdown triggers RedisService.onModuleDestroy
      await resilientApp.close();
      expect(onDestroySpy).toHaveBeenCalledOnce();
    }
  });

  it('does not expose internal Redis errors or stack traces if Redis fails in fail-closed mode', async () => {
    const failClosedApp = await createRateLimitedApp(redisSimulator, {
      failOpen: false,
    });

    try {
      redisSimulator.failNextWith = new Error(
        'Redis cluster ECONNREFUSED 127.0.0.1:6379 internal stack detail',
      );

      const response = await request(failClosedApp.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
        path: '/api/rate-limit-test/items',
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /Redis|ECONNREFUSED|6379|stack/i,
      );
    } finally {
      await failClosedApp.close();
    }
  });

  it('tracks authenticated users independently by User UUID and preserves JWT + RBAC guards', async () => {
    const tokenUser1 = await jwtService.signAsync({
      sub: USER_1,
      email: 'u1@example.com',
      role: 'CUSTOMER',
    });
    const tokenUser2 = await jwtService.signAsync({
      sub: USER_2,
      email: 'u2@example.com',
      role: 'CUSTOMER',
    });
    const tokenNoPerm = await jwtService.signAsync({
      sub: USER_NO_PERM,
      email: 'noperm@example.com',
      role: 'CUSTOMER',
    });

    // User 1 makes 15 requests and hits 429 on the 16th
    for (let i = 1; i <= 15; i++) {
      const res = await request(app.getHttpServer())
        .get('/api/rate-limit-test/protected-orders')
        .set('Authorization', `Bearer ${tokenUser1}`)
        .expect(200);
      expect(res.body.data).toEqual({ userId: USER_1, orders: [] });
    }
    await request(app.getHttpServer())
      .get('/api/rate-limit-test/protected-orders')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(429);

    // User 2 on the exact same IP still has a full 15-request quota
    const user2Res = await request(app.getHttpServer())
      .get('/api/rate-limit-test/protected-orders')
      .set('Authorization', `Bearer ${tokenUser2}`)
      .expect(200);
    expect(user2Res.body.data).toEqual({ userId: USER_2, orders: [] });
    expect(user2Res.headers['x-ratelimit-remaining']).toBe('14');

    // User without 'order:read' permission still receives 403 Forbidden from PermissionsGuard
    await request(app.getHttpServer())
      .get('/api/rate-limit-test/protected-orders')
      .set('Authorization', `Bearer ${tokenNoPerm}`)
      .expect(403);

    // Unauthenticated request to protected route still receives 401 Unauthorized from JwtAuthGuard
    await request(app.getHttpServer())
      .get('/api/rate-limit-test/protected-orders')
      .expect(401);
  });

  it('tracks anonymous requests by client IP independently', async () => {
    const proxyApp = await createRateLimitedApp(redisSimulator, {
      trustProxy: 1,
    });

    try {
      for (let i = 1; i <= 15; i++) {
        await request(proxyApp.getHttpServer())
          .get('/api/rate-limit-test/items')
          .set('X-Forwarded-For', '203.0.113.10')
          .expect(200);
      }

      // 16th request from IP 203.0.113.10 is blocked
      await request(proxyApp.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(429);

      // Request from a different IP 203.0.113.20 is allowed
      const secondIpRes = await request(proxyApp.getHttpServer())
        .get('/api/rate-limit-test/items')
        .set('X-Forwarded-For', '203.0.113.20')
        .expect(200);
      expect(secondIpRes.headers['x-ratelimit-remaining']).toBe('14');
    } finally {
      await proxyApp.close();
    }
  });

  it('isolates counters between different endpoints and different HTTP methods', async () => {
    // Exhaust GET /api/rate-limit-test/items (15 requests)
    for (let i = 1; i <= 15; i++) {
      await request(app.getHttpServer())
        .get('/api/rate-limit-test/items')
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/api/rate-limit-test/items')
      .expect(429);

    // Different HTTP method (POST /api/rate-limit-test/items) has its own independent counter
    const postRes = await request(app.getHttpServer())
      .post('/api/rate-limit-test/items')
      .expect(201);
    expect(postRes.body.data).toEqual({ created: true });
    expect(postRes.headers['x-ratelimit-remaining']).toBe('14');

    // Different endpoint (GET /api/rate-limit-test/other) has its own independent counter
    const otherRes = await request(app.getHttpServer())
      .get('/api/rate-limit-test/other')
      .expect(200);
    expect(otherRes.body.data).toEqual({ section: 'other' });
    expect(otherRes.headers['x-ratelimit-remaining']).toBe('14');
  });

  it('enforces endpoint-specific @Throttle overrides and @SkipThrottle exemptions', async () => {
    // @Throttle(RATE_LIMIT_POLICIES.AUTH_STRICT) -> limit of 5 requests per 60s
    for (let i = 1; i <= 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/rate-limit-test/strict-login')
        .expect(201);
      expect(res.headers['x-ratelimit-limit']).toBe('5');
      expect(res.headers['x-ratelimit-remaining']).toBe(String(5 - i));
    }

    // 6th request to strict endpoint is blocked with 429
    await request(app.getHttpServer())
      .post('/api/rate-limit-test/strict-login')
      .expect(429);

    // @SkipThrottle() -> health endpoint is never throttled even after 20 requests
    const evalCallsBeforeHealth = redisSimulator.eval.mock.calls.length;
    for (let i = 1; i <= 20; i++) {
      await request(app.getHttpServer())
        .get('/api/rate-limit-test/health')
        .expect(200);
    }
    expect(redisSimulator.eval.mock.calls.length).toBe(evalCallsBeforeHealth);
  });
});

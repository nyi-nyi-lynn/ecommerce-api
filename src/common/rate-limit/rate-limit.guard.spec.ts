import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { RateLimitGuard } from './rate-limit.guard.js';

describe('RateLimitGuard (unit)', () => {
  const USER_A = '550e8400-e29b-41d4-a716-446655440000';
  const USER_B = '660e8400-e29b-41d4-a716-446655440001';

  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };
  let guard: RateLimitGuard;

  beforeEach(() => {
    jwtService = {
      verifyAsync: vi.fn(),
    };
    const options: ThrottlerModuleOptions = {
      throttlers: [{ name: 'default', ttl: 60_000, limit: 15 }],
    };
    const storage: ThrottlerStorage = {
      increment: vi.fn(),
    };
    guard = new RateLimitGuard(
      options,
      storage,
      new Reflector(),
      jwtService as unknown as JwtService,
    );
  });

  describe('getTracker', () => {
    it('tracks authenticated requests by existing request.user.sub UUID', async () => {
      const req = {
        user: { sub: USER_A, email: 'a@example.com', role: 'CUSTOMER' },
        headers: {},
        ip: '203.0.113.5',
      };

      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe(`user:${USER_A}`);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('resolves and caches request.user from a valid Bearer JWT before JwtAuthGuard runs', async () => {
      jwtService.verifyAsync.mockResolvedValueOnce({
        sub: USER_B,
        email: 'b@example.com',
        role: 'CUSTOMER',
      });

      const req: Record<string, any> = {
        headers: { authorization: 'Bearer valid.jwt.token' },
        ip: '203.0.113.5',
      };

      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe(`user:${USER_B}`);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid.jwt.token');
      expect(req.user).toEqual({
        sub: USER_B,
        email: 'b@example.com',
        role: 'CUSTOMER',
      });
    });

    it('falls back to normalized client IP when unauthenticated or when Bearer JWT is invalid/non-UUID', async () => {
      const unauthReq = {
        headers: {},
        ip: '::ffff:198.51.100.42',
      };
      expect(await (guard as any).getTracker(unauthReq)).toBe(
        'ip:198.51.100.42',
      );

      // Expired or tampered JWT falls back to IP without throwing 401 in tracker
      jwtService.verifyAsync.mockRejectedValueOnce(new Error('jwt expired'));
      const expiredReq = {
        headers: { authorization: 'Bearer expired.jwt.token' },
        ip: '198.51.100.99',
      };
      expect(await (guard as any).getTracker(expiredReq)).toBe(
        'ip:198.51.100.99',
      );

      // Non-UUID subject in JWT payload is rejected for user tracking and falls back to IP
      jwtService.verifyAsync.mockResolvedValueOnce({
        sub: 'not-a-uuid',
        email: 'bad@example.com',
        role: 'CUSTOMER',
      });
      const nonUuidReq: Record<string, any> = {
        headers: { authorization: 'Bearer non-uuid.jwt.token' },
        ip: '198.51.100.77',
      };
      expect(await (guard as any).getTracker(nonUuidReq)).toBe(
        'ip:198.51.100.77',
      );
      expect(nonUuidReq.user).toBeUndefined();
    });

    it('ignores untrusted request body fields and arbitrary user-supplied headers', async () => {
      const spoofAttemptReq = {
        headers: {
          'x-user-id': USER_A,
          'x-client-id': USER_B,
          'x-forwarded-for': '1.2.3.4',
        },
        body: {
          userId: USER_A,
          sub: USER_B,
        },
        ip: '203.0.113.10',
      };

      const tracker = await (guard as any).getTracker(spoofAttemptReq);
      expect(tracker).toBe('ip:203.0.113.10');
    });
  });

  describe('generateKey', () => {
    function createContext(
      controllerClass: { name: string },
      handlerFn: { name: string },
      method: string,
      baseUrl = '/api/products',
      routePath = '/:id',
    ): ExecutionContext {
      return {
        getClass: () => controllerClass,
        getHandler: () => handlerFn,
        switchToHttp: () => ({
          getRequest: () => ({
            method,
            baseUrl,
            route: { path: routePath },
          }),
        }),
      } as unknown as ExecutionContext;
    }

    it('isolates keys by tracker identity, HTTP method, endpoint handler, and throttler name', () => {
      const getProductsCtx = createContext(
        { name: 'ProductsController' },
        { name: 'findAll' },
        'GET',
        '/api/products',
        '/',
      );
      const postProductsCtx = createContext(
        { name: 'ProductsController' },
        { name: 'create' },
        'POST',
        '/api/products',
        '/',
      );
      const getProductByIdCtx = createContext(
        { name: 'ProductsController' },
        { name: 'findOne' },
        'GET',
        '/api/products',
        '/:id',
      );

      const userAKey = (guard as any).generateKey(
        getProductsCtx,
        `user:${USER_A}`,
        'default',
      );
      const userBKey = (guard as any).generateKey(
        getProductsCtx,
        `user:${USER_B}`,
        'default',
      );
      const ipKey = (guard as any).generateKey(
        getProductsCtx,
        'ip:203.0.113.10',
        'default',
      );
      const postKey = (guard as any).generateKey(
        postProductsCtx,
        `user:${USER_A}`,
        'default',
      );
      const byIdKey = (guard as any).generateKey(
        getProductByIdCtx,
        `user:${USER_A}`,
        'default',
      );
      const customThrottlerKey = (guard as any).generateKey(
        getProductsCtx,
        `user:${USER_A}`,
        'strict',
      );

      const uniqueKeys = new Set([
        userAKey,
        userBKey,
        ipKey,
        postKey,
        byIdKey,
        customThrottlerKey,
      ]);
      expect(uniqueKeys.size).toBe(6);
    });
  });
});


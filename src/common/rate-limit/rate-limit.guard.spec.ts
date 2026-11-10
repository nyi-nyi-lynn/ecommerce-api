import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
  DEVICE_ID_COOKIE_NAME,
} from './rate-limit.constants.js';
import {
  RateLimitGuard,
  generateDeviceId,
  isValidDeviceId,
  normalizeClientIp,
  parseCookieValue,
} from './rate-limit.guard.js';

describe('RateLimitGuard (unit)', () => {
  const VALID_DEVICE_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const VALID_DEVICE_B = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

  let storage: { increment: ReturnType<typeof vi.fn> };
  let guard: RateLimitGuard;

  beforeEach(async () => {
    const options: ThrottlerModuleOptions = {
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 15,
          blockDuration: DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
        },
      ],
    };
    storage = {
      increment: vi.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    };
    guard = new RateLimitGuard(
      options,
      storage as unknown as ThrottlerStorage,
      new Reflector(),
    );
    await guard.onModuleInit();
  });

  describe('Device ID generation and validation', () => {
    it('generates cryptographically secure 128-bit (32 hex char) unique device IDs', () => {
      const id1 = generateDeviceId();
      const id2 = generateDeviceId();

      expect(id1).toMatch(/^[0-9a-f]{32}$/);
      expect(id2).toMatch(/^[0-9a-f]{32}$/);
      expect(id1).not.toBe(id2);
      expect(isValidDeviceId(id1)).toBe(true);
      expect(isValidDeviceId(id2)).toBe(true);
    });

    it('rejects missing, short, non-hex, or malformed device IDs', () => {
      expect(isValidDeviceId(undefined)).toBe(false);
      expect(isValidDeviceId(null)).toBe(false);
      expect(isValidDeviceId('')).toBe(false);
      expect(isValidDeviceId('12345')).toBe(false);
      expect(isValidDeviceId('device-a')).toBe(false);
      expect(isValidDeviceId('550e8400-e29b-41d4-a716-446655440000')).toBe(
        false,
      );
      expect(isValidDeviceId('g1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe(false);
      expect(isValidDeviceId('../etc/passwd')).toBe(false);
      expect(isValidDeviceId('a'.repeat(100))).toBe(false);
    });

    it('reuses an existing valid device cookie and normalizes uppercase hex to lowercase', async () => {
      const setHeader = vi.fn();
      const req: Record<string, any> = {
        headers: {
          cookie: `other=value; ${DEVICE_ID_COOKIE_NAME}=${VALID_DEVICE_A.toUpperCase()}`,
        },
        ip: '192.168.1.10',
      };
      const res = {
        getHeader: vi.fn(),
        setHeader,
      };

      const resolved = (guard as any).resolveDeviceId(req, res);
      expect(resolved).toBe(VALID_DEVICE_A);
      expect(await (guard as any).getTracker(req)).toBe(VALID_DEVICE_A);
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('issues a new HttpOnly cookie when the device cookie is missing or malformed', () => {
      const setHeader = vi.fn();
      const res = {
        getHeader: vi.fn().mockReturnValue(undefined),
        setHeader,
      };
      const reqMissing: Record<string, any> = {
        headers: {},
        ip: '192.168.1.10',
      };

      const issuedId = (guard as any).resolveDeviceId(reqMissing, res);
      expect(isValidDeviceId(issuedId)).toBe(true);
      expect(setHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringContaining(`${DEVICE_ID_COOKIE_NAME}=${issuedId}`),
      );
      const cookieHeader = String(setHeader.mock.calls[0]?.[1]);
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('SameSite=Lax');
      expect(cookieHeader).toContain('Path=/');
      expect(cookieHeader).toContain('Max-Age=31536000');

      const setHeaderInvalid = vi.fn();
      const reqMalformed: Record<string, any> = {
        headers: {
          cookie: `${DEVICE_ID_COOKIE_NAME}=malformed-device-id`,
        },
        ip: '192.168.1.10',
      };
      const reissuedId = (guard as any).resolveDeviceId(reqMalformed, {
        getHeader: vi.fn(),
        setHeader: setHeaderInvalid,
      });
      expect(isValidDeviceId(reissuedId)).toBe(true);
      expect(reissuedId).not.toBe('malformed-device-id');
      expect(setHeaderInvalid).toHaveBeenCalledOnce();
    });

    it('never trusts arbitrary device IDs in request headers, query params, or body', async () => {
      const spoofAttemptReq: Record<string, any> = {
        headers: {
          'x-device-id': VALID_DEVICE_A,
          'device-id': VALID_DEVICE_A,
          'x-client-id': VALID_DEVICE_B,
        },
        query: {
          deviceId: VALID_DEVICE_A,
          device_id: VALID_DEVICE_A,
        },
        body: {
          deviceId: VALID_DEVICE_B,
          device_id: VALID_DEVICE_B,
        },
        ip: '192.168.1.10',
      };

      const tracker = await (guard as any).getTracker(spoofAttemptReq);
      expect(isValidDeviceId(tracker)).toBe(true);
      expect(tracker).not.toBe(VALID_DEVICE_A);
      expect(tracker).not.toBe(VALID_DEVICE_B);
    });
  });

  describe('Client IP extraction and plain-text normalization', () => {
    it('normalizes IPv4, IPv4-mapped IPv6, loopback, and IPv6 addresses into plain text', () => {
      expect(normalizeClientIp('192.168.1.10')).toBe('192.168.1.10');
      expect(normalizeClientIp('::ffff:192.168.1.10')).toBe('192.168.1.10');
      expect(normalizeClientIp('::1')).toBe('127.0.0.1');
      expect(normalizeClientIp('2001:DB8::1')).toBe('2001:db8::1');
      expect(normalizeClientIp('fe80::1%eth0')).toBe('fe80::1');
      expect(normalizeClientIp('')).toBe('127.0.0.1');
      expect(normalizeClientIp('invalid-ip')).toBe('127.0.0.1');
    });

    it('passes the device ID and plain-text normalized IP to RedisThrottlerStorage', async () => {
      const req: Record<string, any> = {
        headers: {
          cookie: `${DEVICE_ID_COOKIE_NAME}=${VALID_DEVICE_A}`,
        },
        ip: '::ffff:192.168.1.10',
      };
      const res: Record<string, any> = {
        header: vi.fn(),
        getHeader: vi.fn(),
        setHeader: vi.fn(),
      };
      const context = {
        getClass: () => ({ name: 'ProductsController' }),
        getHandler: () => ({ name: 'findAll' }),
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
      } as unknown as ExecutionContext;

      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
      expect(storage.increment).toHaveBeenCalledWith(
        VALID_DEVICE_A,
        60_000,
        15,
        180_000,
        'default',
        '192.168.1.10',
      );
    });

    it('parses cookies safely even when URL-encoded or containing malformed percent sequences', () => {
      expect(
        parseCookieValue(`foo=bar; ${DEVICE_ID_COOKIE_NAME}=${VALID_DEVICE_B}`),
      ).toBe(VALID_DEVICE_B);
      expect(parseCookieValue(`${DEVICE_ID_COOKIE_NAME}=%E0%A4%A`)).toBe(
        '%E0%A4%A',
      );
      expect(parseCookieValue('')).toBeUndefined();
    });
  });
});

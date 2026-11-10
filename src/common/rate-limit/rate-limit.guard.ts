import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, Response } from 'express';
import {
  DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
  DEFAULT_RATE_LIMIT_ERROR_MESSAGE,
  DEFAULT_THROTTLER_NAME,
  DEVICE_COOKIE_MAX_AGE_SECONDS,
  DEVICE_ID_BYTE_LENGTH,
  DEVICE_ID_COOKIE_NAME,
} from './rate-limit.constants.js';
import type { RedisThrottlerStorage } from './redis-throttler.storage.js';

const DEVICE_ID_PATTERN = /^[0-9a-f]{32,64}$/i;

export type RateLimitRequest = Request & {
  rateLimitDeviceId?: string;
};

export function generateDeviceId(): string {
  return randomBytes(DEVICE_ID_BYTE_LENGTH).toString('hex');
}

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value.trim());
}

export function parseCookieValue(
  cookieHeader: unknown,
  cookieName = DEVICE_ID_COOKIE_NAME,
): string | undefined {
  if (typeof cookieHeader !== 'string' || cookieHeader.trim() === '') {
    return undefined;
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = pair.slice(0, eqIndex).trim();
    if (name !== cookieName) {
      continue;
    }
    const rawValue = pair.slice(eqIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
}

export function serializeDeviceCookie(
  deviceId: string,
  options?: {
    secure?: boolean;
    maxAgeSeconds?: number;
  },
): string {
  const maxAge = options?.maxAgeSeconds ?? DEVICE_COOKIE_MAX_AGE_SECONDS;
  const parts = [
    `${DEVICE_ID_COOKIE_NAME}=${deviceId}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options?.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function normalizeClientIp(rawIp: unknown): string {
  if (typeof rawIp !== 'string') {
    return '127.0.0.1';
  }
  const trimmed = rawIp.trim();
  if (!trimmed) {
    return '127.0.0.1';
  }

  const zoneIndex = trimmed.indexOf('%');
  const withoutZone =
    zoneIndex === -1 ? trimmed : trimmed.slice(0, zoneIndex).trim();

  if (withoutZone.toLowerCase().startsWith('::ffff:')) {
    const mappedIpv4 = withoutZone.slice(7);
    if (isIP(mappedIpv4) === 4) {
      return mappedIpv4;
    }
  }

  if (withoutZone === '::1' || withoutZone === '0:0:0:0:0:0:0:1') {
    return '127.0.0.1';
  }

  const ipVersion = isIP(withoutZone);
  if (ipVersion === 4) {
    return withoutZone;
  }
  if (ipVersion === 6) {
    return withoutZone.toLowerCase();
  }

  return '127.0.0.1';
}

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected errorMessage = DEFAULT_RATE_LIMIT_ERROR_MESSAGE;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.map((throttler) => ({
      ...throttler,
      blockDuration:
        typeof throttler.blockDuration === 'number' &&
        throttler.blockDuration > 0
          ? throttler.blockDuration
          : DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
    }));
  }

  protected resolveDeviceId(
    req: RateLimitRequest,
    res?: Record<string, any>,
  ): string {
    if (isValidDeviceId(req.rateLimitDeviceId)) {
      return req.rateLimitDeviceId;
    }

    const cookieCandidate = parseCookieValue(
      req.headers?.cookie,
      DEVICE_ID_COOKIE_NAME,
    );
    if (isValidDeviceId(cookieCandidate)) {
      const normalizedDeviceId = cookieCandidate.trim().toLowerCase();
      req.rateLimitDeviceId = normalizedDeviceId;
      return normalizedDeviceId;
    }

    const newDeviceId = generateDeviceId();
    req.rateLimitDeviceId = newDeviceId;
    if (res) {
      this.issueDeviceCookie(req, res as Response, newDeviceId);
    }
    return newDeviceId;
  }

  protected extractClientIp(req: RateLimitRequest): string {
    const rawIp =
      (typeof req.ip === 'string' && req.ip.trim()) ||
      (typeof req.socket?.remoteAddress === 'string' &&
        req.socket.remoteAddress.trim()) ||
      '127.0.0.1';

    return normalizeClientIp(rawIp);
  }

  protected override async getTracker(
    req: Record<string, any>,
  ): Promise<string> {
    return this.resolveDeviceId(req as RateLimitRequest);
  }

  protected override generateKey(
    _context: ExecutionContext,
    trackerString: string,
    _throttlerName: string,
  ): string {
    return trackerString;
  }

  protected override async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const {
      context,
      limit,
      ttl,
      throttler,
      blockDuration,
      generateKey,
    } = requestProps;
    const { req, res } = this.getRequestResponse(context);
    const request = req as RateLimitRequest;

    const ignoreUserAgents =
      throttler.ignoreUserAgents ?? this.commonOptions?.ignoreUserAgents;
    if (Array.isArray(ignoreUserAgents)) {
      const userAgent = request.headers?.['user-agent'] ?? '';
      for (const pattern of ignoreUserAgents) {
        if (pattern.test(userAgent)) {
          return true;
        }
      }
    }

    const throttlerName = throttler.name ?? DEFAULT_THROTTLER_NAME;
    const deviceId = this.resolveDeviceId(request, res);
    const ipAddress = this.extractClientIp(request);
    const key = generateKey(context, deviceId, throttlerName);
    const effectiveBlockDuration =
      typeof blockDuration === 'number' && blockDuration > 0
        ? blockDuration
        : DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS;

    const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
      await (this.storageService as RedisThrottlerStorage).increment(
        key,
        ttl,
        limit,
        effectiveBlockDuration,
        throttlerName,
        ipAddress,
      );

    const getThrottlerSuffix = (name: string) =>
      name === 'default' ? '' : `-${name}`;
    const setHeaders =
      throttler.setHeaders ?? this.commonOptions?.setHeaders ?? true;

    if (isBlocked) {
      if (setHeaders) {
        this.setResponseHeader(
          res,
          `Retry-After${getThrottlerSuffix(throttlerName)}`,
          timeToBlockExpire,
        );
      }
      await this.throwThrottlingException(context, {
        limit,
        ttl,
        key,
        tracker: deviceId,
        totalHits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire,
      });
    }

    if (setHeaders) {
      this.setResponseHeader(
        res,
        `${this.headerPrefix}-Limit${getThrottlerSuffix(throttlerName)}`,
        limit,
      );
      this.setResponseHeader(
        res,
        `${this.headerPrefix}-Remaining${getThrottlerSuffix(throttlerName)}`,
        Math.max(0, limit - totalHits),
      );
      this.setResponseHeader(
        res,
        `${this.headerPrefix}-Reset${getThrottlerSuffix(throttlerName)}`,
        timeToExpire,
      );
    }

    return true;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const retryAfterSeconds = Math.max(
      1,
      throttlerLimitDetail.timeToBlockExpire ||
        throttlerLimitDetail.timeToExpire ||
        1,
    );
    const existingRetryAfter =
      typeof res?.getHeader === 'function'
        ? res.getHeader('Retry-After')
        : undefined;
    if (existingRetryAfter === undefined) {
      this.setResponseHeader(res, 'Retry-After', retryAfterSeconds);
    }

    throw new ThrottlerException(
      await this.getErrorMessage(context, throttlerLimitDetail),
    );
  }

  private issueDeviceCookie(
    req: RateLimitRequest,
    res: Response,
    deviceId: string,
  ): void {
    const secure =
      process.env.RATE_LIMIT_COOKIE_SECURE === 'true' ||
      (process.env.RATE_LIMIT_COOKIE_SECURE !== 'false' &&
        (process.env.NODE_ENV === 'production' || req.secure === true));
    const serialized = serializeDeviceCookie(deviceId, { secure });

    if (
      typeof res.getHeader === 'function' &&
      typeof res.setHeader === 'function'
    ) {
      const existing = res.getHeader('Set-Cookie');
      if (Array.isArray(existing)) {
        const filtered = existing.filter(
          (cookie) => !String(cookie).startsWith(`${DEVICE_ID_COOKIE_NAME}=`),
        );
        res.setHeader('Set-Cookie', [...filtered, serialized]);
        return;
      }
      if (
        typeof existing === 'string' &&
        !existing.startsWith(`${DEVICE_ID_COOKIE_NAME}=`)
      ) {
        res.setHeader('Set-Cookie', [existing, serialized]);
        return;
      }
      res.setHeader('Set-Cookie', serialized);
      return;
    }

    this.setResponseHeader(res, 'Set-Cookie', serialized);
  }
}

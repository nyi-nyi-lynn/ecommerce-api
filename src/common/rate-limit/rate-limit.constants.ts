import type { ConfigService } from '@nestjs/config';

export const DEFAULT_THROTTLER_NAME = 'default';
export const DEFAULT_RATE_LIMIT_TTL_MS = 60_000;
export const DEFAULT_RATE_LIMIT_LIMIT = 15;
export const DEFAULT_RATE_LIMIT_BLOCK_DURATION_SECONDS = 180;
export const DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS =
  DEFAULT_RATE_LIMIT_BLOCK_DURATION_SECONDS * 1000;
export const DEFAULT_DEVICE_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

export const DEVICE_ID_COOKIE_NAME = 'device_id';
export const DEVICE_ID_BYTE_LENGTH = 16;
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const RATE_LIMIT_DEVICE_KEY_PREFIX = 'rate-limit:device:';
export const RATE_LIMIT_REQUESTS_KEY_PREFIX = 'rate-limit:requests:';
export const RATE_LIMIT_BLOCKED_KEY_PREFIX = 'rate-limit:blocked:';

export const DEFAULT_RATE_LIMIT_ERROR_MESSAGE =
  'Too many requests. Please try again later.';

export function buildDeviceMetadataKey(deviceId: string): string {
  return `${RATE_LIMIT_DEVICE_KEY_PREFIX}${deviceId}`;
}

export function buildDeviceRequestsKey(deviceId: string): string {
  return `${RATE_LIMIT_REQUESTS_KEY_PREFIX}${deviceId}`;
}

export function buildDeviceBlockedKey(deviceId: string): string {
  return `${RATE_LIMIT_BLOCKED_KEY_PREFIX}${deviceId}`;
}

export function resolveBlockDurationMs(config?: ConfigService): number {
  const rawSeconds =
    config?.get<unknown>('RATE_LIMIT_BLOCK_DURATION_SECONDS') ??
    process.env.RATE_LIMIT_BLOCK_DURATION_SECONDS;
  if (rawSeconds !== undefined && rawSeconds !== '') {
    const parsedSeconds = Number(rawSeconds);
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return Math.trunc(parsedSeconds * 1000);
    }
  }

  const rawMs =
    config?.get<unknown>('RATE_LIMIT_BLOCK_DURATION_MS') ??
    process.env.RATE_LIMIT_BLOCK_DURATION_MS;
  if (rawMs !== undefined && rawMs !== '') {
    const parsedMs = Number(rawMs);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.trunc(parsedMs);
    }
  }

  return DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS;
}

export const RATE_LIMIT_POLICIES = {
  DEFAULT: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: DEFAULT_RATE_LIMIT_LIMIT,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  AUTH_STRICT: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 5,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  AUTH_SESSION: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 10,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  ADMIN_WRITE: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 10,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  CART_READ: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 30,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  CART_MUTATION: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 20,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  CART_CLEAR: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 10,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  ORDER_MUTATION: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 5,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
  PAYMENT_SUBMIT: {
    [DEFAULT_THROTTLER_NAME]: {
      limit: 5,
      ttl: DEFAULT_RATE_LIMIT_TTL_MS,
    },
  },
} as const;

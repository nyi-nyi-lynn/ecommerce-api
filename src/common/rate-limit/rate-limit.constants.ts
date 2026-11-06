export const DEFAULT_THROTTLER_NAME = 'default';
export const DEFAULT_RATE_LIMIT_TTL_MS = 60_000;
export const DEFAULT_RATE_LIMIT_LIMIT = 15;
export const DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS = 0;
export const DEFAULT_RATE_LIMIT_KEY_PREFIX = 'ecommerce:rl:';
export const DEFAULT_RATE_LIMIT_ERROR_MESSAGE =
  'Too many requests. Please try again later.';

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

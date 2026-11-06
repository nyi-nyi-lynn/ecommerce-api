import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';
import {
  DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
  DEFAULT_REDIS_DB,
  DEFAULT_REDIS_HOST,
  DEFAULT_REDIS_MAX_RETRIES_PER_REQUEST,
  DEFAULT_REDIS_PORT,
  MAX_REDIS_DB,
} from './redis.constants.js';

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export function validateRedisEnvironment(env: Record<string, unknown>) {
  const rawHost = env.REDIS_HOST ?? DEFAULT_REDIS_HOST;
  if (typeof rawHost !== 'string') {
    throw new Error('REDIS_HOST must be a non-empty hostname or IP address');
  }
  const host = rawHost.trim();
  if (!host || /\s/.test(host)) {
    throw new Error('REDIS_HOST must be a non-empty hostname or IP address');
  }

  const rawPort = env.REDIS_PORT ?? DEFAULT_REDIS_PORT;
  if (typeof rawPort !== 'number' && typeof rawPort !== 'string') {
    throw new Error('REDIS_PORT must be an integer between 1 and 65535');
  }
  const portString =
    typeof rawPort === 'number' ? String(rawPort) : rawPort.trim();
  const port = typeof rawPort === 'number' ? rawPort : Number(portString);
  if (
    portString === '' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('REDIS_PORT must be an integer between 1 and 65535');
  }

  const rawPassword = env.REDIS_PASSWORD;
  if (rawPassword !== undefined && typeof rawPassword !== 'string') {
    throw new Error('REDIS_PASSWORD must be a string');
  }
  const password =
    typeof rawPassword === 'string' && rawPassword.length > 0
      ? rawPassword
      : undefined;

  const rawDb = env.REDIS_DB ?? DEFAULT_REDIS_DB;
  if (typeof rawDb !== 'number' && typeof rawDb !== 'string') {
    throw new Error(
      `REDIS_DB must be an integer between 0 and ${MAX_REDIS_DB}`,
    );
  }
  const dbString = typeof rawDb === 'number' ? String(rawDb) : rawDb.trim();
  const db = typeof rawDb === 'number' ? rawDb : Number(dbString);
  if (
    dbString === '' ||
    !Number.isInteger(db) ||
    db < 0 ||
    db > MAX_REDIS_DB
  ) {
    throw new Error(
      `REDIS_DB must be an integer between 0 and ${MAX_REDIS_DB}`,
    );
  }

  return {
    REDIS_HOST: host,
    REDIS_PORT: port,
    REDIS_PASSWORD: password,
    REDIS_DB: db,
  };
}

export function getRedisConnectionConfig(
  config: ConfigService,
): RedisConnectionConfig {
  const validated = validateRedisEnvironment({
    REDIS_HOST: config.get<unknown>('REDIS_HOST'),
    REDIS_PORT: config.get<unknown>('REDIS_PORT'),
    REDIS_PASSWORD: config.get<unknown>('REDIS_PASSWORD'),
    REDIS_DB: config.get<unknown>('REDIS_DB'),
  });

  return {
    host: validated.REDIS_HOST,
    port: validated.REDIS_PORT,
    password: validated.REDIS_PASSWORD,
    db: validated.REDIS_DB,
  };
}

export function buildRedisOptions(config: ConfigService): RedisOptions {
  const { host, port, password, db } = getRedisConnectionConfig(config);

  return {
    host,
    port,
    ...(password !== undefined ? { password } : {}),
    db,
    lazyConnect: true,
    connectTimeout: DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: DEFAULT_REDIS_MAX_RETRIES_PER_REQUEST,
    enableOfflineQueue: false,
  };
}


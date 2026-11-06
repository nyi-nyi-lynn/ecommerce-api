import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChainableCommander, Redis } from 'ioredis';
import {
  getRedisConnectionConfig,
  type RedisConnectionConfig,
} from './redis-config.js';
import { REDIS_CLIENT } from './redis.constants.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly connectionConfig: RedisConnectionConfig;

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly config: ConfigService,
  ) {
    this.connectionConfig = getRedisConnectionConfig(this.config);
    this.registerEventListeners();
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  getClient(): Redis {
    return this.client;
  }

  async connect(): Promise<void> {
    const status = this.client.status;
    if (status === 'ready' || status === 'connect' || status === 'connecting') {
      return;
    }

    try {
      await this.client.connect();
    } catch (error) {
      throw this.handleError(error, 'connect');
    }
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      const response = await this.client.ping();
      if (response !== 'PONG') {
        throw new Error(`Unexpected Redis PING response: ${String(response)}`);
      }
      return true;
    } catch (error) {
      throw this.handleError(error, 'checkConnectivity');
    }
  }

  async eval<T = unknown>(
    script: string,
    keys: string[],
    args: Array<string | number> = [],
  ): Promise<T> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      const result = await this.client.eval(
        script,
        keys.length,
        ...keys,
        ...args,
      );
      return result as T;
    } catch (error) {
      throw this.handleError(error, 'eval');
    }
  }

  async executeTransaction<T = unknown>(
    build: (pipeline: ChainableCommander) => void,
  ): Promise<T[]> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      const pipeline = this.client.multi();
      build(pipeline);
      const results = await pipeline.exec();
      if (!results) {
        throw new Error('Redis transaction was aborted (EXEC returned null)');
      }

      const values: T[] = [];
      for (const [commandError, value] of results) {
        if (commandError) {
          throw commandError;
        }
        values.push(value as T);
      }
      return values;
    } catch (error) {
      throw this.handleError(error, 'executeTransaction');
    }
  }

  handleError(error: unknown, operation = 'operation'): Error {
    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown Redis error';
    const sanitizedMessage = this.sanitizeMessage(rawMessage);
    const target = this.formatTarget();

    this.logger.error(
      `Redis ${operation} failed (${target}): ${sanitizedMessage}`,
    );

    if (error instanceof Error && error.message === sanitizedMessage) {
      return error;
    }
    return new Error(sanitizedMessage);
  }

  async close(): Promise<void> {
    const status = this.client.status;
    if (!status || status === 'end') {
      return;
    }

    if (status === 'wait' || status === 'close') {
      this.client.disconnect();
      return;
    }

    try {
      await this.client.quit();
      this.logger.log(`Closed Redis connection (${this.formatTarget()})`);
    } catch (error) {
      const sanitized = this.sanitizeMessage(
        error instanceof Error ? error.message : String(error),
      );
      this.logger.warn(
        `Redis QUIT failed (${this.formatTarget()}): ${sanitized}. Forcing disconnect.`,
      );
      this.client.disconnect();
    }
  }

  private registerEventListeners(): void {
    if (typeof this.client.on !== 'function') {
      return;
    }

    const target = this.formatTarget();

    this.client.on('ready', () => {
      this.logger.log(`Redis connection ready (${target})`);
    });

    this.client.on('error', (error: unknown) => {
      const message = this.sanitizeMessage(
        error instanceof Error ? error.message : String(error),
      );
      this.logger.error(`Redis client error (${target}): ${message}`);
    });

    this.client.on('reconnecting', () => {
      this.logger.warn(`Reconnecting to Redis (${target})`);
    });

    this.client.on('close', () => {
      this.logger.debug?.(`Redis connection closed (${target})`);
    });
  }

  private formatTarget(): string {
    const { host, port, db } = this.connectionConfig;
    return `${host}:${port}/db${db}`;
  }

  private sanitizeMessage(message: string): string {
    let sanitized = message;
    const password = this.connectionConfig.password;
    if (password) {
      sanitized = sanitized.replaceAll(password, '[REDACTED]');
    }
    sanitized = sanitized
      .replace(/redis(s)?:\/\/[^@\s]*@/gi, 'redis$1://[REDACTED]@')
      .replace(/\b(AUTH|password)\s*[:=]?\s*\S+/gi, '$1 [REDACTED]');
    return sanitized;
  }
}

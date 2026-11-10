import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisModule } from '../../redis/redis.module.js';
import {
  DEFAULT_RATE_LIMIT_ERROR_MESSAGE,
  DEFAULT_RATE_LIMIT_LIMIT,
  DEFAULT_RATE_LIMIT_TTL_MS,
  DEFAULT_THROTTLER_NAME,
  resolveBlockDurationMs,
} from './rate-limit.constants.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Global()
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [RedisThrottlerStorage, ConfigService],
      useFactory: (
        storage: RedisThrottlerStorage,
        config: ConfigService,
      ) => ({
        errorMessage: DEFAULT_RATE_LIMIT_ERROR_MESSAGE,
        storage,
        throttlers: [
          {
            name: DEFAULT_THROTTLER_NAME,
            ttl: DEFAULT_RATE_LIMIT_TTL_MS,
            limit: DEFAULT_RATE_LIMIT_LIMIT,
            blockDuration: resolveBlockDurationMs(config),
          },
        ],
      }),
    }),
  ],
  providers: [RedisThrottlerStorage],
  exports: [ThrottlerModule, RedisThrottlerStorage],
})
export class RateLimitModule {}

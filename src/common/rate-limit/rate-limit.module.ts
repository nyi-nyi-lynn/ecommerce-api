import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisModule } from '../../redis/redis.module.js';
import {
  DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
  DEFAULT_RATE_LIMIT_ERROR_MESSAGE,
  DEFAULT_RATE_LIMIT_LIMIT,
  DEFAULT_RATE_LIMIT_TTL_MS,
  DEFAULT_THROTTLER_NAME,
} from './rate-limit.constants.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Global()
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        errorMessage: DEFAULT_RATE_LIMIT_ERROR_MESSAGE,
        storage,
        throttlers: [
          {
            name: DEFAULT_THROTTLER_NAME,
            ttl: DEFAULT_RATE_LIMIT_TTL_MS,
            limit: DEFAULT_RATE_LIMIT_LIMIT,
            blockDuration: DEFAULT_RATE_LIMIT_BLOCK_DURATION_MS,
          },
        ],
      }),
    }),
  ],
  providers: [RedisThrottlerStorage],
  exports: [ThrottlerModule, RedisThrottlerStorage],
})
export class RateLimitModule {}

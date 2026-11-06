import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { RedisService } from '../../redis/redis.service.js';
import { DEFAULT_RATE_LIMIT_KEY_PREFIX } from './rate-limit.constants.js';

export const RATE_LIMIT_INCREMENT_LUA = `
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = redis.call('INCR', KEYS[1])
  local hitTtl = redis.call('PTTL', KEYS[1])
  if hitTtl < 0 then
    redis.call('PEXPIRE', KEYS[1], blockTtl)
    hitTtl = blockTtl
  end
  return { hits, hitTtl, 1, blockTtl }
end

local hits = redis.call('INCR', KEYS[1])
local hitTtl = redis.call('PTTL', KEYS[1])
if hits == 1 or hitTtl < 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
  hitTtl = ttl
end

if hits > limit then
  if blockDuration > ttl then
    redis.call('SET', KEYS[2], '1', 'PX', blockDuration, 'NX')
    local currentBlockTtl = redis.call('PTTL', KEYS[2])
    if currentBlockTtl <= 0 then
      currentBlockTtl = blockDuration
    end
    return { hits, hitTtl, 1, currentBlockTtl }
  end
  return { hits, hitTtl, 1, hitTtl }
end

return { hits, hitTtl, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(
    private readonly redisService: RedisService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const baseKey = `${DEFAULT_RATE_LIMIT_KEY_PREFIX}${throttlerName}:${key}`;
    const hitKey = `${baseKey}:hits`;
    const blockKey = `${baseKey}:block`;

    let result: [number, number, number, number];
    try {
      result = await this.redisService.eval<[number, number, number, number]>(
        RATE_LIMIT_INCREMENT_LUA,
        [hitKey, blockKey],
        [ttl, limit, blockDuration],
      );
    } catch (error) {
      if (this.isFailOpen()) {
        this.logger.warn(
          'Redis rate-limit storage unavailable; failing open for current request.',
        );
        return {
          totalHits: 1,
          timeToExpire: Math.max(1, Math.ceil(ttl / 1000)),
          isBlocked: false,
          timeToBlockExpire: 0,
        };
      }
      throw error;
    }

    const [totalHitsRaw, hitTtlMsRaw, isBlockedRaw, blockTtlMsRaw] = result;

    const totalHits = Number(totalHitsRaw);
    const hitTtlMs = Math.max(0, Number(hitTtlMsRaw));
    const isBlocked = Number(isBlockedRaw) === 1;
    const blockTtlMs = Math.max(0, Number(blockTtlMsRaw));

    const timeToExpire = Math.max(1, Math.ceil((hitTtlMs || ttl) / 1000));
    const timeToBlockExpire = isBlocked
      ? Math.max(1, Math.ceil((blockTtlMs || hitTtlMs || ttl) / 1000))
      : 0;

    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire,
    };
  }

  private isFailOpen(): boolean {
    const rawValue =
      this.config?.get<unknown>('RATE_LIMIT_FAIL_OPEN') ??
      process.env.RATE_LIMIT_FAIL_OPEN;
    if (rawValue === false || rawValue === 'false') {
      return false;
    }
    return true;
  }
}

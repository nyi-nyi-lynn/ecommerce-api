import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { RedisService } from '../../redis/redis.service.js';
import {
  DEFAULT_DEVICE_METADATA_TTL_MS,
  buildDeviceBlockedKey,
  buildDeviceMetadataKey,
  buildDeviceRequestsKey,
  resolveBlockDurationMs,
} from './rate-limit.constants.js';

export const RATE_LIMIT_DEVICE_LUA = `
local deviceKey = KEYS[1]
local requestsKey = KEYS[2]
local blockedKey = KEYS[3]

local deviceId = ARGV[1]
local ipAddress = ARGV[2]
local nowMs = tonumber(ARGV[3])
local windowMs = tonumber(ARGV[4])
local limit = tonumber(ARGV[5])
local blockDurationMs = tonumber(ARGV[6])
local deviceTtlMs = tonumber(ARGV[7])

redis.call('HSETNX', deviceKey, 'firstSeenAt', tostring(nowMs))
redis.call('HSET', deviceKey, 'deviceId', deviceId)
redis.call('HSET', deviceKey, 'ipAddress', ipAddress)
redis.call('HSET', deviceKey, 'lastSeenAt', tostring(nowMs))
redis.call('PEXPIRE', deviceKey, deviceTtlMs)

local blockedUntilRaw = redis.call('GET', blockedKey)
if blockedUntilRaw then
  local blockedUntilMs = tonumber(blockedUntilRaw)
  local remainingBlockMs = 0
  if blockedUntilMs then
    remainingBlockMs = blockedUntilMs - nowMs
  else
    remainingBlockMs = redis.call('PTTL', blockedKey)
  end
  if remainingBlockMs > 0 then
    local currentHits = redis.call('ZCARD', requestsKey)
    return { currentHits, remainingBlockMs, 1, remainingBlockMs, blockedUntilMs or (nowMs + remainingBlockMs) }
  end
  redis.call('DEL', blockedKey)
end

local minScore = nowMs - windowMs
redis.call('ZREMRANGEBYSCORE', requestsKey, '-inf', minScore)

local member = tostring(nowMs)
local suffix = 1
while redis.call('ZSCORE', requestsKey, member) ~= false do
  suffix = suffix + 1
  member = tostring(nowMs) .. ':' .. tostring(suffix)
end
redis.call('ZADD', requestsKey, nowMs, member)
redis.call('PEXPIRE', requestsKey, windowMs)

local totalHits = redis.call('ZCARD', requestsKey)
local oldestEntry = redis.call('ZRANGE', requestsKey, 0, 0, 'WITHSCORES')
local oldestTimestampMs = oldestEntry and oldestEntry[2] and tonumber(oldestEntry[2]) or nowMs
local windowRemainingMs = math.max(1, (oldestTimestampMs + windowMs) - nowMs)

if totalHits > limit then
  local effectiveBlockMs = blockDurationMs > 0 and blockDurationMs or windowMs
  local blockedUntilMs = nowMs + effectiveBlockMs
  redis.call('SET', blockedKey, tostring(blockedUntilMs), 'PX', effectiveBlockMs)
  if effectiveBlockMs < windowMs then
    redis.call('PEXPIRE', requestsKey, effectiveBlockMs)
  end
  if effectiveBlockMs > deviceTtlMs then
    redis.call('PEXPIRE', deviceKey, effectiveBlockMs)
  end
  return { totalHits, windowRemainingMs, 1, effectiveBlockMs, blockedUntilMs }
end

return { totalHits, windowRemainingMs, 0, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(
    private readonly redisService: RedisService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async increment(
    deviceId: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
    ipAddress = '127.0.0.1',
  ): Promise<ThrottlerStorageRecord> {
    const effectiveBlockDurationMs =
      typeof blockDuration === 'number' && blockDuration > 0
        ? blockDuration
        : resolveBlockDurationMs(this.config);
    const nowMs = Date.now();
    const deviceMetadataTtlMs = Math.max(
      DEFAULT_DEVICE_METADATA_TTL_MS,
      ttl,
      effectiveBlockDurationMs,
    );

    const deviceKey = buildDeviceMetadataKey(deviceId);
    const requestsKey = buildDeviceRequestsKey(deviceId);
    const blockedKey = buildDeviceBlockedKey(deviceId);

    let result: [number, number, number, number, number?];
    try {
      result = await this.redisService.eval<
        [number, number, number, number, number?]
      >(
        RATE_LIMIT_DEVICE_LUA,
        [deviceKey, requestsKey, blockedKey],
        [
          deviceId,
          ipAddress,
          nowMs,
          ttl,
          limit,
          effectiveBlockDurationMs,
          deviceMetadataTtlMs,
        ],
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
      ? Math.max(1, Math.ceil((blockTtlMs || effectiveBlockDurationMs) / 1000))
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

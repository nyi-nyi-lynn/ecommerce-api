import { Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { ChainableCommander, Redis } from 'ioredis';
import { validateEnvironment } from '../auth/token-config.js';
import {
  buildRedisOptions,
  getRedisConnectionConfig,
  validateRedisEnvironment,
} from './redis-config.js';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisModule } from './redis.module.js';
import { RedisService } from './redis.service.js';

describe('Redis Integration (Phase 2)', () => {
  describe('Redis Configuration & Validation', () => {
    it('applies defaults when optional Redis environment variables are omitted', () => {
      const validated = validateRedisEnvironment({});
      expect(validated).toEqual({
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        REDIS_PASSWORD: undefined,
        REDIS_DB: 0,
      });
    });

    it('parses custom REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, and REDIS_DB via validateEnvironment', () => {
      const validated = validateEnvironment({
        JWT_ACCESS_TOKEN_TTL: '15m',
        JWT_REFRESH_TOKEN_TTL_SECONDS: '604800',
        REDIS_HOST: '  redis.internal.local  ',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'super-secret-redis-pass',
        REDIS_DB: '3',
      });

      expect(validated).toMatchObject({
        REDIS_HOST: 'redis.internal.local',
        REDIS_PORT: 6380,
        REDIS_PASSWORD: 'super-secret-redis-pass',
        REDIS_DB: 3,
      });
    });

    it('normalizes empty REDIS_PASSWORD to undefined', () => {
      const validated = validateRedisEnvironment({
        REDIS_PASSWORD: '',
      });
      expect(validated.REDIS_PASSWORD).toBeUndefined();
    });

    it('rejects invalid REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, and REDIS_DB values', () => {
      expect(() => validateRedisEnvironment({ REDIS_HOST: '   ' })).toThrow(
        /REDIS_HOST/,
      );
      expect(() =>
        validateRedisEnvironment({ REDIS_HOST: 'bad host name' }),
      ).toThrow(/REDIS_HOST/);
      expect(() => validateRedisEnvironment({ REDIS_HOST: 123 })).toThrow(
        /REDIS_HOST/,
      );

      expect(() => validateRedisEnvironment({ REDIS_PORT: '0' })).toThrow(
        /REDIS_PORT/,
      );
      expect(() => validateRedisEnvironment({ REDIS_PORT: '70000' })).toThrow(
        /REDIS_PORT/,
      );
      expect(() => validateRedisEnvironment({ REDIS_PORT: 'abc' })).toThrow(
        /REDIS_PORT/,
      );

      expect(() => validateRedisEnvironment({ REDIS_PASSWORD: 12345 })).toThrow(
        /REDIS_PASSWORD/,
      );

      expect(() => validateRedisEnvironment({ REDIS_DB: '-1' })).toThrow(
        /REDIS_DB/,
      );
      expect(() => validateRedisEnvironment({ REDIS_DB: '16' })).toThrow(
        /REDIS_DB/,
      );
      expect(() => validateRedisEnvironment({ REDIS_DB: '1.5' })).toThrow(
        /REDIS_DB/,
      );
    });

    it('builds ioredis options from ConfigService without exposing undefined password', () => {
      const config = new ConfigService({
        REDIS_HOST: '10.0.0.15',
        REDIS_PORT: 6381,
        REDIS_DB: 2,
      });

      const options = buildRedisOptions(config);
      expect(options).toEqual({
        host: '10.0.0.15',
        port: 6381,
        db: 2,
        lazyConnect: true,
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      expect('password' in options).toBe(false);

      const configWithPassword = new ConfigService({
        REDIS_HOST: '10.0.0.15',
        REDIS_PORT: 6381,
        REDIS_PASSWORD: 'secret-value',
        REDIS_DB: 2,
      });
      expect(getRedisConnectionConfig(configWithPassword).password).toBe(
        'secret-value',
      );
      expect(buildRedisOptions(configWithPassword).password).toBe(
        'secret-value',
      );
    });
  });

  describe('RedisService Lifecycle, Operations, and Error Handling', () => {
    const SECRET_PASSWORD = 'my-ultra-secret-redis-password';
    let mockClient: {
      status: string;
      connect: ReturnType<typeof vi.fn>;
      ping: ReturnType<typeof vi.fn>;
      eval: ReturnType<typeof vi.fn>;
      multi: ReturnType<typeof vi.fn>;
      quit: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      listeners: Map<string, (...args: unknown[]) => void>;
    };
    let configService: ConfigService;
    let service: RedisService;

    beforeEach(async () => {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      mockClient = {
        status: 'wait',
        connect: vi.fn(async () => {
          mockClient.status = 'ready';
        }),
        ping: vi.fn().mockResolvedValue('PONG'),
        eval: vi.fn().mockResolvedValue(1),
        multi: vi.fn(),
        quit: vi.fn(async () => {
          mockClient.status = 'end';
          return 'OK';
        }),
        disconnect: vi.fn(() => {
          mockClient.status = 'end';
        }),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          listeners.set(event, handler);
          return mockClient;
        }),
        listeners,
      };

      configService = new ConfigService({
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        REDIS_PASSWORD: SECRET_PASSWORD,
        REDIS_DB: 0,
      });

      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          { provide: REDIS_CLIENT, useValue: mockClient as unknown as Redis },
          { provide: ConfigService, useValue: configService },
          RedisService,
        ],
      }).compile();

      service = moduleRef.get<RedisService>(RedisService);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('initializes RedisService, registers lifecycle event listeners, and exposes the shared client', () => {
      expect(service).toBeDefined();
      expect(service.getClient()).toBe(mockClient);
      expect(mockClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith(
        'reconnecting',
        expect.any(Function),
      );
      expect(mockClient.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('connects on module initialization and verifies connectivity via PING', async () => {
      await service.onModuleInit();
      expect(mockClient.connect).toHaveBeenCalledOnce();
      expect(mockClient.status).toBe('ready');

      // Calling connect() again when already ready is a no-op
      await service.connect();
      expect(mockClient.connect).toHaveBeenCalledOnce();

      const connected = await service.checkConnectivity();
      expect(connected).toBe(true);
      expect(mockClient.ping).toHaveBeenCalledOnce();
    });

    it('propagates and logs sanitized connection failures without leaking secrets', async () => {
      const errorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      mockClient.connect.mockRejectedValueOnce(
        new Error(
          `Connection refused to redis://:${SECRET_PASSWORD}@127.0.0.1:6379 with password=${SECRET_PASSWORD}`,
        ),
      );

      await expect(service.onModuleInit()).rejects.toThrow(
        /Connection refused/,
      );

      expect(errorSpy).toHaveBeenCalledOnce();
      const loggedMessage = String(errorSpy.mock.calls[0]?.[0]);
      expect(loggedMessage).toContain('127.0.0.1:6379/db0');
      expect(loggedMessage).not.toContain(SECRET_PASSWORD);
      expect(loggedMessage).toContain('[REDACTED]');
    });

    it('propagates connectivity check errors when PING fails or returns unexpected output', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      mockClient.ping.mockResolvedValueOnce('LOADING' as unknown as 'PONG');
      await expect(service.checkConnectivity()).rejects.toThrow(
        'Unexpected Redis PING response: LOADING',
      );

      mockClient.ping.mockRejectedValueOnce(new Error('Socket closed'));
      await expect(service.checkConnectivity()).rejects.toThrow(
        'Socket closed',
      );
    });

    it('executes atomic Lua scripts via eval and handles operation failures', async () => {
      mockClient.eval.mockResolvedValueOnce([1, 60000, 0, 0]);

      const result = await service.eval<number[]>(
        'return { redis.call("INCR", KEYS[1]), tonumber(ARGV[1]) }',
        ['rl:key:1'],
        [60000],
      );

      expect(mockClient.connect).toHaveBeenCalledOnce();
      expect(mockClient.eval).toHaveBeenCalledWith(
        'return { redis.call("INCR", KEYS[1]), tonumber(ARGV[1]) }',
        1,
        'rl:key:1',
        60000,
      );
      expect(result).toEqual([1, 60000, 0, 0]);

      const errorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockClient.eval.mockRejectedValueOnce(
        new Error(`ERR Lua script failed: AUTH ${SECRET_PASSWORD}`),
      );

      await expect(service.eval('invalid', ['rl:key:1'], [])).rejects.toThrow(
        'ERR Lua script failed: AUTH [REDACTED]',
      );
      expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain(
        SECRET_PASSWORD,
      );
    });

    it('executes atomic MULTI/EXEC transactions and surfaces transaction or command errors', async () => {
      const pipelineMock = {
        incr: vi.fn().mockReturnThis(),
        pttl: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 3],
          [null, 58000],
        ]),
      };
      mockClient.multi.mockReturnValue(
        pipelineMock as unknown as ChainableCommander,
      );

      const values = await service.executeTransaction<number>((pipeline) => {
        pipeline.incr('counter:key');
        pipeline.pttl('counter:key');
      });

      expect(values).toEqual([3, 58000]);
      expect(pipelineMock.incr).toHaveBeenCalledWith('counter:key');
      expect(pipelineMock.pttl).toHaveBeenCalledWith('counter:key');

      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      // Aborted transaction (null result)
      pipelineMock.exec.mockResolvedValueOnce(null);
      await expect(
        service.executeTransaction((pipeline) => {
          pipeline.incr('counter:key');
        }),
      ).rejects.toThrow('Redis transaction was aborted');

      // Per-command error inside EXEC tuple
      pipelineMock.exec.mockResolvedValueOnce([
        [new Error('WRONGTYPE Operation against a key'), null],
      ]);
      await expect(
        service.executeTransaction((pipeline) => {
          pipeline.incr('counter:key');
        }),
      ).rejects.toThrow('WRONGTYPE Operation against a key');
    });

    it('sanitizes asynchronous client error events logged by event listeners', () => {
      const errorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const logSpy = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      mockClient.listeners.get('ready')?.();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Redis connection ready (127.0.0.1:6379/db0)'),
      );

      mockClient.listeners.get('reconnecting')?.();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting to Redis (127.0.0.1:6379/db0)'),
      );

      mockClient.listeners.get('error')?.(
        new Error(`NOAUTH Authentication failed for ${SECRET_PASSWORD}`),
      );
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain(
        SECRET_PASSWORD,
      );
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('[REDACTED]');
    });

    it('gracefully closes the connection via QUIT on shutdown and falls back to disconnect if needed', async () => {
      await service.onModuleInit();
      expect(mockClient.status).toBe('ready');

      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalledOnce();
      expect(mockClient.status).toBe('end');

      // Calling close() again when already ended is a no-op
      await service.close();
      expect(mockClient.quit).toHaveBeenCalledOnce();
      expect(mockClient.disconnect).not.toHaveBeenCalled();

      // When client is in 'wait' state, close() disconnects without sending QUIT
      mockClient.status = 'wait';
      await service.close();
      expect(mockClient.disconnect).toHaveBeenCalledOnce();

      // When QUIT throws, close() logs a warning and forces disconnect()
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockClient.status = 'ready';
      mockClient.quit.mockRejectedValueOnce(new Error('Connection reset'));
      await service.close();
      expect(mockClient.disconnect).toHaveBeenCalledTimes(2);
    });

    it('provides a singleton RedisService and REDIS_CLIENT across modules via RedisModule', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                REDIS_HOST: '127.0.0.1',
                REDIS_PORT: 6379,
                REDIS_DB: 0,
              }),
            ],
          }),
          RedisModule,
        ],
      }).compile();

      const redisService = moduleRef.get(RedisService);
      const redisClient = moduleRef.get<Redis>(REDIS_CLIENT);

      expect(redisService).toBeInstanceOf(RedisService);
      expect(redisService.getClient()).toBe(redisClient);

      await redisService.close();
    });
  });
});

import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  normalizeIp,
} from '@nestjs/throttler';
import { isUUID } from 'class-validator';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { DEFAULT_RATE_LIMIT_ERROR_MESSAGE } from './rate-limit.constants.js';

type RateLimitRequest = Request & {
  user?: Partial<JwtPayload>;
};

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected errorMessage = DEFAULT_RATE_LIMIT_ERROR_MESSAGE;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Optional() private readonly jwtService?: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(
    req: Record<string, any>,
  ): Promise<string> {
    const request = req as RateLimitRequest;

    const existingUserId = request.user?.sub;
    if (typeof existingUserId === 'string' && isUUID(existingUserId)) {
      return `user:${existingUserId}`;
    }

    const authHeader = request.headers?.authorization;
    if (
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ') &&
      this.jwtService
    ) {
      const token = authHeader.slice(7).trim();
      if (token) {
        try {
          const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
          if (typeof payload?.sub === 'string' && isUUID(payload.sub)) {
            request.user = payload;
            return `user:${payload.sub}`;
          }
        } catch {
          // Invalid or expired tokens fall back to client IP tracking so
          // downstream JwtAuthGuard still returns 401 on protected routes
          // while repeated invalid token floods are rate-limited by IP.
        }
      }
    }

    const rawIp =
      (typeof request.ip === 'string' && request.ip.trim()) ||
      (typeof request.socket?.remoteAddress === 'string' &&
        request.socket.remoteAddress.trim()) ||
      '127.0.0.1';
    const normalizedIp =
      normalizeIp(rawIp, this.ipv6SubnetPrefix) || '127.0.0.1';

    return `ip:${normalizedIp}`;
  }

  protected override generateKey(
    context: ExecutionContext,
    trackerString: string,
    throttlerName: string,
  ): string {
    const request = context.switchToHttp().getRequest<RateLimitRequest>();
    const method = (request?.method ?? 'GET').toUpperCase();
    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;
    const routeTemplate =
      typeof request?.route?.path === 'string'
        ? `${request.baseUrl ?? ''}${request.route.path}`
        : `${controllerName}.${handlerName}`;

    const rawKey = `${throttlerName}:${method}:${controllerName}:${handlerName}:${routeTemplate}:${trackerString}`;
    return createHash('sha256').update(rawKey).digest('hex');
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
}

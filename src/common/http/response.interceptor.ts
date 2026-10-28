import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { REDIRECT_METADATA, SSE_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';

interface SuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
  path: string;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const handler = context.getHandler();
    if (
      Reflect.getMetadata(REDIRECT_METADATA, handler) !== undefined ||
      Reflect.getMetadata(SSE_METADATA, handler) !== undefined
    ) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => {
        if (
          response.statusCode === 204 ||
          data instanceof StreamableFile ||
          this.hasNonJsonContentType(response)
        ) {
          return data;
        }

        if (this.isSuccessEnvelope(data)) return data;

        const envelope: SuccessEnvelope = {
          success: true,
          data,
          timestamp: new Date().toISOString(),
          path: request.path,
        };
        return envelope;
      }),
    );
  }

  private hasNonJsonContentType(response: Response): boolean {
    const contentType = response.getHeader('content-type');
    return (
      typeof contentType === 'string' &&
      !contentType.toLowerCase().includes('application/json') &&
      !contentType.toLowerCase().includes('+json')
    );
  }

  private isSuccessEnvelope(value: unknown): value is SuccessEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const candidate = value as Partial<SuccessEnvelope>;
    return (
      candidate.success === true &&
      'data' in candidate &&
      typeof candidate.timestamp === 'string' &&
      typeof candidate.path === 'string'
    );
  }
}

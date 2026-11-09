import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class StripEmptyMultipartFieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const contentType = request.headers?.['content-type'] ?? '';
    if (
      typeof contentType === 'string' &&
      contentType.toLowerCase().includes('multipart/form-data') &&
      request.body &&
      typeof request.body === 'object'
    ) {
      const body = request.body as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        if (value === '') {
          delete body[key];
        }
      }
    }
    return next.handle();
  }
}

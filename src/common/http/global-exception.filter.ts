import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { Prisma } from '../../generated/prisma/client.js';
import { MulterError } from 'multer';

interface ErrorEnvelope {
  success: false;
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const errorInfo = this.getErrorInfo(exception);
    const envelope: ErrorEnvelope = {
      success: false,
      statusCode: errorInfo.statusCode,
      message: errorInfo.message,
      error: errorInfo.error,
      timestamp: new Date().toISOString(),
      path: request.path,
    };

    response.status(errorInfo.statusCode).json(envelope);
  }

  private getErrorInfo(exception: unknown): {
    statusCode: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof MulterError) {
      if (exception.code === 'LIMIT_FILE_SIZE') {
        return {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          message: 'The product image must be 5 MB or smaller.',
          error: STATUS_CODES[HttpStatus.PAYLOAD_TOO_LARGE] ?? 'Payload Too Large',
        };
      }
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: exception.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Use the predictable file field name: file.'
          : 'The uploaded file is invalid.',
        error: STATUS_CODES[HttpStatus.BAD_REQUEST] ?? 'Bad Request',
      };
    }
    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'A record with these values already exists.',
        error: STATUS_CODES[HttpStatus.CONFLICT] ?? 'Conflict',
      };
    }

    if (!(exception instanceof HttpException)) {
      return this.internalError();
    }

    const statusCode = exception.getStatus();
    if (statusCode < 400 || statusCode >= 500) {
      return this.internalError(
        statusCode >= 500 ? statusCode : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const errorResponse = exception.getResponse();
    const rawMessage =
      typeof errorResponse === 'string'
        ? errorResponse
        : this.getResponseMessage(errorResponse);
    const message = this.normalizeMessage(rawMessage, statusCode);

    return {
      statusCode,
      message,
      error: STATUS_CODES[statusCode] ?? 'Error',
    };
  }

  private getResponseMessage(response: unknown): unknown {
    if (!response || typeof response !== 'object' || !('message' in response)) {
      return undefined;
    }
    return response.message;
  }

  private normalizeMessage(
    value: unknown,
    statusCode: number,
  ): string | string[] {
    if (Array.isArray(value)) {
      const messages = value
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 30)
        .map((item) => this.sanitizeClientMessage(item));
      return messages.length ? messages : this.defaultMessage(statusCode);
    }
    if (typeof value === 'string') return this.sanitizeClientMessage(value);
    return this.defaultMessage(statusCode);
  }

  private sanitizeClientMessage(value: string): string {
    const message = value.trim().slice(0, 500);
    const containsSensitiveDetail =
      /PrismaClient|\bSELECT\b[\s\S]*\bFROM\b|\bINSERT\b[\s\S]*\bINTO\b|\bUPDATE\b[\s\S]*\bSET\b|postgres(?:ql)?:\/\/|\bBearer\s+\S+|\b(?:password|secret|authorization)\s*[:=]\s*\S+/i.test(
        message,
      ) ||
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(message) ||
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}\b/i.test(
        message,
      );
    return containsSensitiveDetail
      ? 'The request could not be processed.'
      : message;
  }

  private defaultMessage(statusCode: number): string {
    return STATUS_CODES[statusCode] ?? 'Request failed.';
  }

  private internalError(statusCode = HttpStatus.INTERNAL_SERVER_ERROR) {
    return {
      statusCode,
      message: 'Internal server error',
      error: STATUS_CODES[statusCode] ?? 'Internal Server Error',
    };
  }
}

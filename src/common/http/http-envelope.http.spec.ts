import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  INestApplication,
  NotFoundException,
  Post,
  Redirect,
  Res,
  StreamableFile,
  UnauthorizedException,
  Body,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsString, MinLength } from 'class-validator';
import { MulterError } from 'multer';
import request from 'supertest';
import { createTestHttpApp } from '../../../test/helpers/create-test-http-app.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppController } from '../../app.controller.js';
import { PrismaService } from '../../prisma/prisma.service.js';

class ExampleDto {
  @IsString()
  @MinLength(3)
  name: string;
}

@Controller('response-test')
class ResponseTestController {
  @Get('object')
  object() {
    return { id: 4, nested: { keep: true }, pagination: { total: 1, page: 1 } };
  }

  @Post('created')
  created() {
    return { id: 8, label: 'created' };
  }

  @Get('wrapped')
  wrapped() {
    return {
      success: true,
      data: { source: 'already wrapped' },
      timestamp: '2025-01-01T00:00:00.000Z',
      path: '/response-test/wrapped',
    };
  }

  @Get('empty')
  @HttpCode(204)
  empty(): void {}

  @Get('bad-request')
  badRequest(): never {
    throw new BadRequestException('The request is invalid.');
  }

  @Post('validation')
  validation(@Body() _dto: ExampleDto) {
    return { accepted: true };
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedException('Authentication is required.');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('Permission denied.');
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Resource not found.');
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException('The value already exists.');
  }

  @Get('too-many-requests')
  tooManyRequests(@Res({ passthrough: true }) res: Response): never {
    res.setHeader('Retry-After', '42');
    res.setHeader('X-Custom-Header', 'preserved-value');
    throw new ThrottlerException();
  }

  @Get('sensitive-client-message')
  sensitiveClientMessage(): never {
    throw new BadRequestException(
      `Rejected refresh credential: 550e8400-e29b-41d4-a716-446655440000.${'a'.repeat(43)}`,
    );
  }

  @Get('unknown')
  unknown(): never {
    throw new Error(
      'PrismaClient failure: password=do-not-return SQL SELECT secret',
    );
  }

  @Get('unique-constraint')
  uniqueConstraint(): never {
    throw new Prisma.PrismaClientKnownRequestError('private database detail', {
      code: 'P2002',
      clientVersion: 'test',
    });
  }

  @Get('multer-size')
  multerSize(): never {
    throw new MulterError('LIMIT_FILE_SIZE', 'image');
  }

  @Get('multer-unexpected-field')
  multerUnexpectedField(): never {
    throw new MulterError('LIMIT_UNEXPECTED_FILE', 'file');
  }

  @Get('file')
  file() {
    return new StreamableFile(Buffer.from('file contents'));
  }

  @Get('redirect')
  @Redirect('/destination', 302)
  redirect() {
    return { url: '/other-destination', statusCode: 307 };
  }
}

describe('Global HTTP response formatting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestHttpApp({
      controllers: [ResponseTestController, AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    });
  });

  afterAll(async () => app.close());

  it('wraps JSON once while preserving response data, pagination metadata, path and status', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/response-test/object')
      .expect(200);
    expect(result.body).toMatchObject({
      success: true,
      data: {
        id: 4,
        nested: { keep: true },
        pagination: { total: 1, page: 1 },
      },
      path: '/api/response-test/object',
    });
    expect(Number.isNaN(Date.parse(result.body.timestamp))).toBe(false);

    const created = await request(app.getHttpServer())
      .post('/api/response-test/created')
      .expect(201);
    expect(created.body.data).toEqual({ id: 8, label: 'created' });

    const alreadyWrapped = await request(app.getHttpServer())
      .get('/api/response-test/wrapped')
      .expect(200);
    expect(alreadyWrapped.body.data.source).toBe('already wrapped');
    expect(alreadyWrapped.body.data.data).toBeUndefined();
  });

  it('keeps 204 responses bodyless and leaves file and redirect responses intact', async () => {
    const empty = await request(app.getHttpServer())
      .get('/api/response-test/empty')
      .expect(204);
    expect(empty.text).toBe('');

    const file = await request(app.getHttpServer())
      .get('/api/response-test/file')
      .expect(200);
    expect(Buffer.isBuffer(file.body)).toBe(true);
    expect(file.body.toString()).toBe('file contents');

    const redirect = await request(app.getHttpServer())
      .get('/api/response-test/redirect')
      .expect(307);
    expect(redirect.headers.location).toBe('/other-destination');
  });

  it('formats standard HTTP and validation exceptions without changing statuses', async () => {
    const badRequest = await request(app.getHttpServer())
      .get('/api/response-test/bad-request')
      .expect(400);
    expect(badRequest.body).toMatchObject({
      success: false,
      statusCode: 400,
      message: 'The request is invalid.',
      error: 'Bad Request',
    });

    const validation = await request(app.getHttpServer())
      .post('/api/response-test/validation')
      .send({ name: 'x' })
      .expect(400);
    expect(validation.body.success).toBe(false);
    expect(Array.isArray(validation.body.message)).toBe(true);
    expect(validation.body.message).toContain(
      'name must be longer than or equal to 3 characters',
    );

    await request(app.getHttpServer())
      .get('/api/response-test/unauthorized')
      .expect(401)
      .expect(({ body }) => expect(body.error).toBe('Unauthorized'));
    await request(app.getHttpServer())
      .get('/api/response-test/forbidden')
      .expect(403)
      .expect(({ body }) => expect(body.error).toBe('Forbidden'));
    await request(app.getHttpServer())
      .get('/api/response-test/not-found')
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe('Not Found'));
    await request(app.getHttpServer())
      .get('/api/response-test/conflict')
      .expect(409)
      .expect(({ body }) => expect(body.error).toBe('Conflict'));
    const throttled = await request(app.getHttpServer())
      .get('/api/response-test/too-many-requests')
      .expect(429);
    expect(throttled.headers['retry-after']).toBe('42');
    expect(throttled.headers['x-custom-header']).toBe('preserved-value');
    expect(throttled.body).toMatchObject({
      success: false,
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      error: 'Too Many Requests',
      path: '/api/response-test/too-many-requests',
    });
    const sensitive = await request(app.getHttpServer())
      .get('/api/response-test/sensitive-client-message')
      .expect(400);
    expect(sensitive.body.message).toBe('The request could not be processed.');
    expect(JSON.stringify(sensitive.body)).not.toContain(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('hides unknown internal details and maps only Prisma unique violations to conflict', async () => {
    const unknown = await request(app.getHttpServer())
      .get('/api/response-test/unknown')
      .expect(500);
    expect(unknown.body).toMatchObject({
      success: false,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
    expect(JSON.stringify(unknown.body)).not.toMatch(
      /PrismaClient|password|do-not-return|SELECT|secret/i,
    );

    const unique = await request(app.getHttpServer())
      .get('/api/response-test/unique-constraint')
      .expect(409);
    expect(unique.body.message).toBe(
      'A record with these values already exists.',
    );
    expect(unique.body.message).not.toContain('private database detail');
  });

  it('formats Multer upload errors with generic image messages and expected "image" field name', async () => {
    const tooLarge = await request(app.getHttpServer())
      .get('/api/response-test/multer-size')
      .expect(413);
    expect(tooLarge.body).toMatchObject({
      success: false,
      statusCode: 413,
      message: 'The uploaded image must be 5 MB or smaller.',
    });

    const unexpectedField = await request(app.getHttpServer())
      .get('/api/response-test/multer-unexpected-field')
      .expect(400);
    expect(unexpectedField.body).toMatchObject({
      success: false,
      statusCode: 400,
      message: 'Use the predictable file field name: image.',
    });
  });

  it('wraps the database health response without losing its fields', async () => {
    const health = await request(app.getHttpServer())
      .get('/api/health/db')
      .expect(200);
    expect(health.body.data).toEqual({ status: 'ok', database: 'connected' });
  });
});

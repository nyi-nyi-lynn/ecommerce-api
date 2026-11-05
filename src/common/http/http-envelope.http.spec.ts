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
  StreamableFile,
  UnauthorizedException,
  ValidationPipe,
  Body,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { Prisma } from '../../generated/prisma/client.js';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import { ResponseInterceptor } from './response.interceptor.js';
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
    const moduleRef = await Test.createTestingModule({
      controllers: [ResponseTestController, AppController],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
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

  it('wraps the database health response without losing its fields', async () => {
    const health = await request(app.getHttpServer())
      .get('/api/health/db')
      .expect(200);
    expect(health.body.data).toEqual({ status: 'ok', database: 'connected' });
  });
});

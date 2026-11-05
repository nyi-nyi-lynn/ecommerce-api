import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    process.env.JWT_SECRET ??= 'e2e-health-test-jwt-secret';
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('/api/health/db (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health/db')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: 'ok',
        database: 'connected',
      },
      path: '/api/health/db',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });
});

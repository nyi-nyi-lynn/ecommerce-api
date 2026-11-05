import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('should be defined', () => {
    expect(appController).toBeDefined();
  });

  it('executes a lightweight readiness query and returns database status', async () => {
    await expect(appController.checkDb()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });
});

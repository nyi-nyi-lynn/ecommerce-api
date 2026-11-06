import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service.js';
import { ApiTags } from '@nestjs/swagger';
import { ApiDocumentEndpoint } from './common/swagger/swagger.decorators.js';

@Controller()
@ApiTags('System')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health/db')
  @SkipThrottle()
  @ApiDocumentEndpoint({
    summary: 'Check database readiness',
    description:
      'Executes a lightweight database query and returns readiness status.',
    errors: [500],
  })
  async checkDb() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      database: 'connected',
    };
  }
}

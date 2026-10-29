import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({
  imports: [PrismaModule, AuthModule, RbacModule],
  controllers: [StockController],
  providers: [StockService, JwtAuthGuard],
  exports: [StockService],
})
export class StockModule {}

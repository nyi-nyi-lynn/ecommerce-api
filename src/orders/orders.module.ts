import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { StockModule } from '../stock/stock.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminOrdersController, OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [PrismaModule, AuthModule, RbacModule, StockModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService, JwtAuthGuard],
})
export class OrdersModule {}

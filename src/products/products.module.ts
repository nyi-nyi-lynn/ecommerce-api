import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { UploadsModule } from '../modules/uploads/uploads.module.js';

@Module({
  imports: [PrismaModule, AuthModule, RbacModule, UploadsModule],
  controllers: [ProductsController],
  providers: [ProductsService, JwtAuthGuard],
})
export class ProductsModule {}

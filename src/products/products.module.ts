import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { UploadsModule } from '../modules/uploads/uploads.module.js';

@Module({
  imports: [AuthModule, RbacModule, UploadsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}

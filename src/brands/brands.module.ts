import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller.js';
import { BrandsService } from './brands.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { UploadsModule } from '../modules/uploads/uploads.module.js';

@Module({
  imports: [AuthModule, RbacModule, UploadsModule],
  controllers: [BrandsController],
  providers: [BrandsService],
})
export class BrandsModule {}

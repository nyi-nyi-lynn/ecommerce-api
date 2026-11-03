import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { RbacModule } from '../../rbac/rbac.module.js';
import { CloudinaryProvider } from './cloudinary.provider.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [AuthModule, PrismaModule, RbacModule],
  providers: [CloudinaryProvider, UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}

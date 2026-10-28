import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RbacController } from './rbac.controller.js';
import { RbacService } from './rbac.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RbacController],
  providers: [PermissionsGuard, RbacService],
  exports: [PermissionsGuard, RbacService],
})
export class RbacModule {}

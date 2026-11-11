import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UploadsModule } from '../modules/uploads/uploads.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { CmsController } from './cms.controller.js';
import { CmsService } from './cms.service.js';

@Module({
  imports: [AuthModule, RbacModule, UploadsModule],
  controllers: [CmsController],
  providers: [CmsService],
})
export class CmsModule {}

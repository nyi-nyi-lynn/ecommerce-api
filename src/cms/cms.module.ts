import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UploadsModule } from '../modules/uploads/uploads.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { CmsController } from './cms.controller.js';
import { CmsService } from './cms.service.js';
import { CmsPublishingController } from './cms-publishing.controller.js';
import { CmsPublicController } from './cms-public.controller.js';

@Module({
  imports: [AuthModule, RbacModule, UploadsModule],
  controllers: [CmsController, CmsPublishingController, CmsPublicController],
  providers: [CmsService],
})
export class CmsModule {}

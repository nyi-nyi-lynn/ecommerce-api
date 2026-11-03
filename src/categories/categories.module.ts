import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UploadsModule } from '../modules/uploads/uploads.module.js';

@Module({
  imports : [PrismaModule,AuthModule,RbacModule,UploadsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService,JwtAuthGuard]
})
export class CategoriesModule {}

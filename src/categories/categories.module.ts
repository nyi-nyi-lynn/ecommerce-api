import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RolesGuard } from './guards/roles.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Module({
  imports : [PrismaModule,AuthModule],
  controllers: [CategoriesController],
  providers: [CategoriesService,RolesGuard,JwtAuthGuard]
})
export class CategoriesModule {}

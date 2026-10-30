import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { AdminPaymentsController, PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [PrismaModule, AuthModule, RbacModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}

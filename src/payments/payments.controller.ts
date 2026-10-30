import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { QueryPaymentsDto } from './dto/query-payments.dto.js';
import { RejectPaymentDto } from './dto/reject-payment.dto.js';
import { SubmitManualPaymentDto } from './dto/submit-manual-payment.dto.js';
import { PaymentsService } from './payments.service.js';

type AuthenticatedRequest = Request & { user: { sub: number } };

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('orders/:orderId')
  getOrderPayments(@Req() request: AuthenticatedRequest, @Param('orderId', ParseIntPipe) orderId: number) {
    return this.payments.getCustomerOrderPayments(request.user.sub, orderId);
  }

  @Post('orders/:orderId/manual')
  submitManual(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SubmitManualPaymentDto,
  ) {
    return this.payments.submitManualPayment(request.user.sub, orderId, dto);
  }
}

@Controller('admin/payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payment:read')
  list(@Query() query: QueryPaymentsDto) {
    return this.payments.listAttempts(query);
  }

  @Get(':attemptId')
  @RequirePermissions('payment:read')
  get(@Param('attemptId', ParseIntPipe) attemptId: number) {
    return this.payments.getAttempt(attemptId);
  }

  @Post(':attemptId/approve')
  @RequirePermissions('payment:update')
  approve(@Param('attemptId', ParseIntPipe) attemptId: number, @Req() request: AuthenticatedRequest) {
    return this.payments.approveManualPayment(attemptId, request.user.sub);
  }

  @Post(':attemptId/reject')
  @RequirePermissions('payment:update')
  reject(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.payments.rejectManualPayment(attemptId, request.user.sub, dto);
  }

  @Post('orders/:orderId/collect-cod')
  @RequirePermissions('payment:collect')
  collectCod(@Param('orderId', ParseIntPipe) orderId: number, @Req() request: AuthenticatedRequest) {
    return this.payments.collectCod(orderId, request.user.sub);
  }
}

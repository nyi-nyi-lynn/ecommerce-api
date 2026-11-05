import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { QueryPaymentsDto } from './dto/query-payments.dto.js';
import { RejectPaymentDto } from './dto/reject-payment.dto.js';
import { SubmitManualPaymentDto } from './dto/submit-manual-payment.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
@UseGuards(JwtAuthGuard)
@ApiTags('Customer Payments')
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('orders/:orderId')
  @ApiDocumentEndpoint({
    summary: 'Get order payment history',
    description:
      'Returns payment attempts for an order owned by the authenticated customer.',
    errors: [400, 401, 404, 500],
  })
  getOrderPayments(
    @CurrentUser('sub') userId: number,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.payments.getCustomerOrderPayments(userId, orderId);
  }

  @Post('orders/:orderId/manual')
  @ApiDocumentEndpoint({
    summary: 'Submit manual payment',
    description:
      'Submits a supported provider reference and optional proof URL for the authenticated customer’s MANUAL order. The server determines amount and currency; manual payment remains under review until staff approval.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 500],
  })
  submitManual(
    @CurrentUser('sub') userId: number,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SubmitManualPaymentDto,
  ) {
    return this.payments.submitManualPayment(userId, orderId, dto);
  }
}

@Controller('admin/payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags('Admin Payments')
@ApiBearerAuth()
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payment:read')
  @ApiDocumentEndpoint({
    summary: 'List payment attempts',
    description: `Returns paginated payment attempts, optionally filtered by status. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 500],
    successExample: {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  })
  list(@Query() query: QueryPaymentsDto) {
    return this.payments.listAttempts(query);
  }

  @Get(':attemptId')
  @RequirePermissions('payment:read')
  @ApiDocumentEndpoint({
    summary: 'Get payment attempt details',
    description: `Returns an attempt and its audit events. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  get(@Param('attemptId', ParseIntPipe) attemptId: number) {
    return this.payments.getAttempt(attemptId);
  }

  @Post(':attemptId/approve')
  @RequirePermissions('payment:update')
  @ApiDocumentEndpoint({
    summary: 'Approve manual payment',
    description: `Approves an eligible MANUAL attempt and marks its Order PAID atomically. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
  })
  approve(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @CurrentUser('sub') actorId: number,
  ) {
    return this.payments.approveManualPayment(attemptId, actorId);
  }

  @Post(':attemptId/reject')
  @RequirePermissions('payment:update')
  @ApiDocumentEndpoint({
    summary: 'Reject manual payment',
    description: `Rejects an eligible MANUAL attempt with a required reason. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
  })
  reject(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @CurrentUser('sub') actorId: number,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.payments.rejectManualPayment(attemptId, actorId, dto);
  }

  @Post('orders/:orderId/collect-cod')
  @RequirePermissions('payment:collect')
  @ApiDocumentEndpoint({
    summary: 'Confirm COD collection',
    description: `Confirms collected cash for an eligible delivered COD order. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
  })
  collectCod(
    @Param('orderId', ParseIntPipe) orderId: number,
    @CurrentUser('sub') actorId: number,
  ) {
    return this.payments.collectCod(orderId, actorId);
  }
}

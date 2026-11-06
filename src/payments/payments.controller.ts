import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { QueryPaymentsDto } from './dto/query-payments.dto.js';
import { RejectPaymentDto } from './dto/reject-payment.dto.js';
import {
  MANUAL_PAYMENT_PROVIDERS,
  SubmitManualPaymentDto,
} from './dto/submit-manual-payment.dto.js';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import { MAX_PRODUCT_IMAGE_BYTES } from '../modules/uploads/uploads.service.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
@UseGuards(JwtAuthGuard)
@ApiTags('Customer Payments')
@ApiBearerAuth()
@ApiExtraModels(SubmitManualPaymentDto)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('orders/:orderId')
  @ApiParam({
    name: 'orderId',
    description: 'Order UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Get order payment history',
    description:
      'Returns payment attempts for an order owned by the authenticated customer.',
    errors: [400, 401, 404, 500],
    successExample: [
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        orderId: '550e8400-e29b-41d4-a716-446655440000',
        method: 'MANUAL',
        provider: 'KPAY',
        status: 'UNDER_REVIEW',
        amount: '259.98',
        currency: 'USD',
        providerRef: 'TXN-98451203',
        proofUrl:
          'https://res.cloudinary.com/demo/image/upload/ecommerce/payments/users/880e8400-e29b-41d4-a716-446655440003/proof.png',
        imagePublicId:
          'ecommerce/payments/users/880e8400-e29b-41d4-a716-446655440003/proof',
        rejectionReason: null,
        submittedAt: '2026-01-01T00:00:00.000Z',
        reviewedAt: null,
        paidAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
  getOrderPayments(
    @CurrentUser('sub') userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.payments.getCustomerOrderPayments(userId, orderId);
  }

  @Post('orders/:orderId/manual')
  @Throttle(RATE_LIMIT_POLICIES.PAYMENT_SUBMIT)
  @ApiParam({
    name: 'orderId',
    description: 'Order UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['providerCode', 'transactionReference', 'image'],
      properties: {
        providerCode: {
          type: 'string',
          enum: [...MANUAL_PAYMENT_PROVIDERS],
          example: 'KBZ_PAY',
        },
        transactionReference: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          example: 'TXN-98451203',
        },
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 },
    }),
  )
  @ApiDocumentEndpoint({
    summary: 'Submit manual payment',
    description:
      'Submits a supported provider reference and payment proof image for the authenticated customer’s MANUAL order. The server determines amount and currency; manual payment remains under review until staff approval.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 500],
    successExample: {
      id: '660e8400-e29b-41d4-a716-446655440001',
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      method: 'MANUAL',
      provider: 'KPAY',
      status: 'UNDER_REVIEW',
      amount: '259.98',
      currency: 'USD',
      providerRef: 'TXN-98451203',
      proofUrl:
        'https://res.cloudinary.com/demo/image/upload/ecommerce/payments/users/880e8400-e29b-41d4-a716-446655440003/proof.png',
      imagePublicId:
        'ecommerce/payments/users/880e8400-e29b-41d4-a716-446655440003/proof',
      rejectionReason: null,
      submittedAt: '2026-01-01T00:00:00.000Z',
      reviewedAt: null,
      paidAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      events: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          paymentAttemptId: '660e8400-e29b-41d4-a716-446655440001',
          actorId: '880e8400-e29b-41d4-a716-446655440003',
          type: 'SUBMITTED',
          message: 'Manual payment submitted for review',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  })
  submitManual(
    @CurrentUser('sub') userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: SubmitManualPaymentDto,
    @UploadedFile() image: Express.Multer.File | undefined,
  ) {
    if (!image) {
      throw new BadRequestException('Payment proof image file is required.');
    }
    return this.payments.submitManualPayment(userId, orderId, dto, image);
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
      items: [
        {
          id: '660e8400-e29b-41d4-a716-446655440001',
          orderId: '550e8400-e29b-41d4-a716-446655440000',
          method: 'MANUAL',
          provider: 'KPAY',
          status: 'UNDER_REVIEW',
          amount: '259.98',
          currency: 'USD',
          reviewedById: null,
          order: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            orderNumber: 'ORD-20260101-A1B2C3',
            userId: '880e8400-e29b-41d4-a716-446655440003',
            user: {
              id: '880e8400-e29b-41d4-a716-446655440003',
              email: 'customer@example.com',
              name: 'Jane Doe',
            },
          },
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  list(@Query() query: QueryPaymentsDto) {
    return this.payments.listAttempts(query);
  }

  @Get(':attemptId')
  @RequirePermissions('payment:read')
  @ApiParam({
    name: 'attemptId',
    description: 'Payment attempt UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Get payment attempt details',
    description: `Returns an attempt and its audit events. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderId: '660e8400-e29b-41d4-a716-446655440001',
      method: 'MANUAL',
      provider: 'KPAY',
      status: 'UNDER_REVIEW',
      amount: '259.98',
      currency: 'USD',
      reviewedById: null,
      events: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          paymentAttemptId: '550e8400-e29b-41d4-a716-446655440000',
          actorId: '880e8400-e29b-41d4-a716-446655440003',
          type: 'SUBMITTED',
          message: 'Manual payment submitted for review',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  })
  get(@Param('attemptId', ParseUUIDPipe) attemptId: string) {
    return this.payments.getAttempt(attemptId);
  }

  @Post(':attemptId/approve')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('payment:update')
  @ApiParam({
    name: 'attemptId',
    description: 'Payment attempt UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Approve manual payment',
    description: `Approves an eligible MANUAL attempt and marks its Order PAID atomically. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'PAID',
      reviewedById: '990e8400-e29b-41d4-a716-446655440004',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      paidAt: '2026-01-01T00:00:00.000Z',
    },
  })
  approve(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.payments.approveManualPayment(attemptId, actorId);
  }

  @Post(':attemptId/reject')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('payment:update')
  @ApiParam({
    name: 'attemptId',
    description: 'Payment attempt UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Reject manual payment',
    description: `Rejects an eligible MANUAL attempt with a required reason. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'REJECTED',
      reviewedById: '990e8400-e29b-41d4-a716-446655440004',
      rejectionReason: 'Transaction reference does not match screenshot',
      reviewedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  reject(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser('sub') actorId: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.payments.rejectManualPayment(attemptId, actorId, dto);
  }

  @Post('orders/:orderId/collect-cod')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('payment:collect')
  @ApiParam({
    name: 'orderId',
    description: 'Order UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Confirm COD collection',
    description: `Confirms collected cash for an eligible delivered COD order. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: {
      id: '660e8400-e29b-41d4-a716-446655440001',
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      method: 'COD',
      provider: 'COD',
      status: 'PAID',
      reviewedById: '990e8400-e29b-41d4-a716-446655440004',
      paidAt: '2026-01-01T00:00:00.000Z',
    },
  })
  collectCod(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.payments.collectCod(orderId, actorId);
  }
}

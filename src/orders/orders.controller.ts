import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { CheckoutOrderDto } from './dto/checkout-order.dto.js';
import { QueryAdminOrdersDto, QueryOrdersDto } from './dto/query-orders.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { OrdersService } from './orders.service.js';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';

@Controller('orders')
@ApiTags('Customer Orders')
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Throttle(RATE_LIMIT_POLICIES.ORDER_MUTATION)
  @UseGuards(JwtAuthGuard)
  @ApiDocumentEndpoint({
    summary: 'Create order directly',
    description:
      'Creates an order from submitted product IDs and quantities. The server loads active product names/prices, calculates totals, and deducts stock transactionally.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 422, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderNumber: 'ORD-20260101-A1B2C3',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      subtotal: '259.98',
      total: '259.98',
      currency: 'USD',
      shippingName: 'Jane Doe',
      shippingPhone: '+959123456789',
      shippingAddress: 'No. 12, Pyay Road, Yangon',
      notes: 'Leave with building reception if unavailable.',
      items: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          orderId: '550e8400-e29b-41d4-a716-446655440000',
          productId: '880e8400-e29b-41d4-a716-446655440003',
          productNameSnapshot: 'Mechanical Keyboard',
          unitPriceSnapshot: '129.99',
          quantity: 2,
          lineTotal: '259.98',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateOrderDto) {
    return this.orders.create(userId, dto);
  }

  @Post('checkout')
  @Throttle(RATE_LIMIT_POLICIES.ORDER_MUTATION)
  @UseGuards(JwtAuthGuard)
  @ApiDocumentEndpoint({
    summary: 'Checkout current cart',
    description:
      'Creates an order from the authenticated customer’s cart. Client-supplied product lists and prices are not accepted. Stock is deducted and the cart is cleared only after all transaction writes succeed.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 422, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderNumber: 'ORD-20260101-A1B2C3',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      subtotal: '259.98',
      total: '259.98',
      currency: 'USD',
      shippingName: 'Jane Doe',
      shippingPhone: '+959123456789',
      shippingAddress: 'No. 12, Pyay Road, Yangon',
      notes: 'Leave with building reception if unavailable.',
      items: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          orderId: '550e8400-e29b-41d4-a716-446655440000',
          productId: '880e8400-e29b-41d4-a716-446655440003',
          productNameSnapshot: 'Mechanical Keyboard',
          unitPriceSnapshot: '129.99',
          quantity: 2,
          lineTotal: '259.98',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  checkout(@CurrentUser('sub') userId: string, @Body() dto: CheckoutOrderDto) {
    return this.orders.checkout(userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiDocumentEndpoint({
    summary: 'List own orders',
    description:
      'Returns paginated orders owned by the authenticated customer.',
    errors: [400, 401, 500],
    successExample: {
      items: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          orderNumber: 'ORD-20260101-A1B2C3',
          userId: '660e8400-e29b-41d4-a716-446655440001',
          status: 'PENDING',
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          subtotal: '259.98',
          total: '259.98',
          currency: 'USD',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  listMine(
    @CurrentUser('sub') userId: string,
    @Query() query: QueryOrdersDto,
  ) {
    return this.orders.listMine(userId, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiParam({
    name: 'id',
    description: 'Order UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Get own order',
    description:
      'Returns an order only when it belongs to the authenticated customer.',
    errors: [400, 401, 404, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderNumber: 'ORD-20260101-A1B2C3',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      subtotal: '259.98',
      total: '259.98',
      currency: 'USD',
      items: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          orderId: '550e8400-e29b-41d4-a716-446655440000',
          productId: '880e8400-e29b-41d4-a716-446655440003',
          productNameSnapshot: 'Mechanical Keyboard',
          unitPriceSnapshot: '129.99',
          quantity: 2,
          lineTotal: '259.98',
        },
      ],
    },
  })
  findMine(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.findMine(userId, id);
  }

  @Post(':id/cancel')
  @Throttle(RATE_LIMIT_POLICIES.ORDER_MUTATION)
  @UseGuards(JwtAuthGuard)
  @ApiParam({
    name: 'id',
    description: 'Order UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Cancel own order',
    description:
      'Customers may cancel their own eligible pending, unpaid order. Stock is restored transactionally; paid orders cannot be cancelled without refund support.',
    errors: [400, 401, 404, 409, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderNumber: 'ORD-20260101-A1B2C3',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'CANCELLED',
      paymentStatus: 'CANCELLED',
      cancelledAt: '2026-01-01T00:00:00.000Z',
    },
  })
  cancelMine(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.cancelMine(userId, id);
  }
}

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags('Admin Orders')
@ApiBearerAuth()
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('order:read')
  @ApiDocumentEndpoint({
    summary: 'List all orders',
    description: `Returns paginated orders with optional status filtering. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 500],
    successExample: {
      items: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          orderNumber: 'ORD-20260101-A1B2C3',
          userId: '660e8400-e29b-41d4-a716-446655440001',
          status: 'PENDING',
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          subtotal: '259.98',
          total: '259.98',
          currency: 'USD',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  list(@Query() query: QueryAdminOrdersDto) {
    return this.orders.listAll(query);
  }

  @Get(':id')
  @RequirePermissions('order:read')
  @ApiParam({
    name: 'id',
    description: 'Order UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Get order details',
    description: `Returns an order by ID. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderNumber: 'ORD-20260101-A1B2C3',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      subtotal: '259.98',
      total: '259.98',
      currency: 'USD',
      items: [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          orderId: '550e8400-e29b-41d4-a716-446655440000',
          productId: '880e8400-e29b-41d4-a716-446655440003',
          productNameSnapshot: 'Mechanical Keyboard',
          unitPriceSnapshot: '129.99',
          quantity: 2,
          lineTotal: '259.98',
        },
      ],
    },
  })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findById(id);
  }

  @Patch(':id/status')
  @RequirePermissions('order:update')
  @ApiParam({
    name: 'id',
    description: 'Order UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Update order status',
    description: `Applies an allowed server-side order status transition. COD payment status is independent. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orderNumber: 'ORD-20260101-A1B2C3',
      userId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'CONFIRMED',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.orders.updateStatus(id, dto, actorId);
  }
}

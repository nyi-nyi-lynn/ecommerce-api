import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
  @UseGuards(JwtAuthGuard)
  @ApiDocumentEndpoint({
    summary: 'Create order directly',
    description:
      'Creates an order from submitted product IDs and quantities. The server loads active product names/prices, calculates totals, and deducts stock transactionally.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 422, 500],
  })
  create(@CurrentUser('sub') userId: number, @Body() dto: CreateOrderDto) {
    return this.orders.create(userId, dto);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiDocumentEndpoint({
    summary: 'Checkout current cart',
    description:
      'Creates an order from the authenticated customer’s cart. Client-supplied product lists and prices are not accepted. Stock is deducted and the cart is cleared only after all transaction writes succeed.',
    successStatus: 201,
    errors: [400, 401, 404, 409, 422, 500],
  })
  checkout(@CurrentUser('sub') userId: number, @Body() dto: CheckoutOrderDto) {
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
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  })
  listMine(
    @CurrentUser('sub') userId: number,
    @Query() query: QueryOrdersDto,
  ) {
    return this.orders.listMine(userId, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiDocumentEndpoint({
    summary: 'Get own order',
    description:
      'Returns an order only when it belongs to the authenticated customer.',
    errors: [400, 401, 404, 500],
  })
  findMine(
    @CurrentUser('sub') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.findMine(userId, id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiDocumentEndpoint({
    summary: 'Cancel own order',
    description:
      'Customers may cancel their own eligible pending, unpaid order. Stock is restored transactionally; paid orders cannot be cancelled without refund support.',
    errors: [400, 401, 404, 409, 500],
  })
  cancelMine(
    @CurrentUser('sub') userId: number,
    @Param('id', ParseIntPipe) id: number,
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
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  })
  list(@Query() query: QueryAdminOrdersDto) {
    return this.orders.listAll(query);
  }

  @Get(':id')
  @RequirePermissions('order:read')
  @ApiDocumentEndpoint({
    summary: 'Get order details',
    description: `Returns an order by ID. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.orders.findById(id);
  }

  @Patch(':id/status')
  @RequirePermissions('order:update')
  @ApiDocumentEndpoint({
    summary: 'Update order status',
    description: `Applies an allowed server-side order status transition. COD payment status is independent. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser('sub') actorId: number,
  ) {
    return this.orders.updateStatus(id, dto, actorId);
  }
}

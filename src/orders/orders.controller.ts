import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { QueryAdminOrdersDto, QueryOrdersDto } from './dto/query-orders.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { OrdersService } from './orders.service.js';

type AuthenticatedRequest = Request & { user: { sub: number } };

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateOrderDto) {
    return this.orders.create(request.user.sub, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  listMine(@Req() request: AuthenticatedRequest, @Query() query: QueryOrdersDto) {
    return this.orders.listMine(request.user.sub, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findMine(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.findMine(request.user.sub, id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancelMine(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.cancelMine(request.user.sub, id);
  }
}

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('order:read')
  list(@Query() query: QueryAdminOrdersDto) {
    return this.orders.listAll(query);
  }

  @Get(':id')
  @RequirePermissions('order:read')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.orders.findById(id);
  }

  @Patch(':id/status')
  @RequirePermissions('order:update')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.updateStatus(id, dto, request.user.sub);
  }
}

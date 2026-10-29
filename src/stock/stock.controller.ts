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
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AdjustStockDto } from './dto/adjust-stock.dto.js';
import { InitializeStockDto } from './dto/initialize-stock.dto.js';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto.js';
import { StockService } from './stock.service.js';

type AuthenticatedRequest = Request & { user: { sub: number } };

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('products/:productId/initialize')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stock:update')
  initialize(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: InitializeStockDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stock.initialize(productId, dto, request.user.sub);
  }

  @Post('products/:productId/adjustments')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stock:update')
  adjust(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: AdjustStockDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stock.adjust(productId, dto, request.user.sub);
  }

  @Get('products/:productId/movements')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stock:read')
  movements(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: QueryStockMovementsDto,
  ) {
    return this.stock.getMovements(productId, query);
  }

  @Get('products/:productId')
  getStock(@Param('productId', ParseIntPipe) productId: number) {
    return this.stock.getStock(productId);
  }
}

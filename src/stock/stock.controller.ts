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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';

type AuthenticatedRequest = Request & { user: { sub: number } };

@Controller('stock')
@ApiTags('Stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('products/:productId/initialize')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stock:update')
  @ApiBearerAuth()
  @ApiDocumentEndpoint({
    summary: 'Initialize product stock',
    description: `Creates the initial stock record and initialization movement. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
  })
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
  @ApiBearerAuth()
  @ApiDocumentEndpoint({
    summary: 'Adjust product stock',
    description: `Applies a non-zero signed quantity change and records a movement atomically. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
  })
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
  @ApiBearerAuth()
  @ApiDocumentEndpoint({
    summary: 'List stock movements',
    description: `Returns paginated movement history, newest first. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  })
  movements(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: QueryStockMovementsDto,
  ) {
    return this.stock.getMovements(productId, query);
  }

  @Get('products/:productId')
  @ApiDocumentEndpoint({
    summary: 'Get product stock availability',
    description:
      'Returns stock availability only when the related product is active.',
    errors: [400, 404, 500],
  })
  getStock(@Param('productId', ParseIntPipe) productId: number) {
    return this.stock.getStock(productId);
  }
}

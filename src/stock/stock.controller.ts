import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AdjustStockDto } from './dto/adjust-stock.dto.js';
import { InitializeStockDto } from './dto/initialize-stock.dto.js';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto.js';
import { StockService } from './stock.service.js';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';

@Controller('stock')
@ApiTags('Stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('products/:productId/initialize')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stock:update')
  @ApiBearerAuth()
  @ApiParam({
    name: 'productId',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Initialize product stock',
    description: `Creates the initial stock record and initialization movement. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: {
      stock: {
        productId: '550e8400-e29b-41d4-a716-446655440000',
        quantity: 25,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      movement: {
        id: '660e8400-e29b-41d4-a716-446655440001',
        productId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '770e8400-e29b-41d4-a716-446655440002',
        type: 'INITIALIZE',
        quantityChange: 25,
        quantityBefore: 0,
        quantityAfter: 25,
        reason: 'Initial warehouse count',
        reference: 'INV-2026-001',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  initialize(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: InitializeStockDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.stock.initialize(productId, dto, actorId);
  }

  @Post('products/:productId/adjustments')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stock:update')
  @ApiBearerAuth()
  @ApiParam({
    name: 'productId',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Adjust product stock',
    description: `Applies a non-zero signed quantity change and records a movement atomically. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: {
      stock: {
        productId: '550e8400-e29b-41d4-a716-446655440000',
        quantity: 22,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      movement: {
        id: '660e8400-e29b-41d4-a716-446655440001',
        productId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '770e8400-e29b-41d4-a716-446655440002',
        type: 'DAMAGED',
        quantityChange: -3,
        quantityBefore: 25,
        quantityAfter: 22,
        reason: 'Damaged items found during inspection',
        reference: 'ADJ-2026-014',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  adjust(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.stock.adjust(productId, dto, actorId);
  }

  @Get('products/:productId/movements')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('stock:read')
  @ApiBearerAuth()
  @ApiParam({
    name: 'productId',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'List stock movements',
    description: `Returns paginated movement history, newest first. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: {
      items: [
        {
          id: '660e8400-e29b-41d4-a716-446655440001',
          productId: '550e8400-e29b-41d4-a716-446655440000',
          userId: '770e8400-e29b-41d4-a716-446655440002',
          type: 'INITIALIZE',
          quantityChange: 25,
          quantityBefore: 0,
          quantityAfter: 25,
          reason: 'Initial warehouse count',
          reference: 'INV-2026-001',
          createdAt: '2026-01-01T00:00:00.000Z',
          user: {
            id: '770e8400-e29b-41d4-a716-446655440002',
            email: 'admin@example.com',
            name: 'Admin User',
          },
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  movements(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: QueryStockMovementsDto,
  ) {
    return this.stock.getMovements(productId, query);
  }

  @Get('products/:productId')
  @ApiParam({
    name: 'productId',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiDocumentEndpoint({
    summary: 'Get product stock availability',
    description:
      'Returns stock availability only when the related product is active.',
    errors: [400, 404, 500],
    successExample: {
      productId: '550e8400-e29b-41d4-a716-446655440000',
      inStock: true,
      availableQuantity: 25,
    },
  })
  getStock(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.stock.getStock(productId);
  }
}

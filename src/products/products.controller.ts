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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { QueryProductsDto } from './dto/query-products.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsService } from './products.service.js';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import type { Request } from 'express';
import { MAX_PRODUCT_IMAGE_BYTES } from '../modules/uploads/uploads.service.js';

type RequestWithUser = Request & { user?: { sub?: number } };

@Controller('products')
@ApiTags('Products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('product:create')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        sku: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
        categoryId: { type: 'integer' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('image', {
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 },
  }))
  @ApiDocumentEndpoint({
    summary: 'Create product',
    description: `Creates a product; its category must exist. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
  })
  create(
    @Body() dto: CreateProductDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.products.create(dto, image, request.user?.sub);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('product:update')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        sku: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
        categoryId: { type: 'integer' },
        isActive: { type: 'boolean' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('image', {
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 },
  }))
  @ApiDocumentEndpoint({
    summary: 'Update product',
    description: `Updates product fields. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.products.update(id, dto, image, request.user?.sub);
  }

  @Get()
  @ApiDocumentEndpoint({
    summary: 'List products',
    description:
      'Returns active products with database pagination, allowlisted sorting, category/price filters, and name search.',
    errors: [400, 500],
    successExample: {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  })
  findAll(@Query() query: QueryProductsDto) {
    return this.products.findAll(query);
  }

  @Get('slug/:slug')
  @ApiDocumentEndpoint({
    summary: 'Get product by slug',
    description: 'Returns an active product by its unique slug.',
    errors: [404, 500],
  })
  findBySlug(@Param('slug') slug: string) {
    return this.products.findBySlug(slug);
  }

  @Get(':id')
  @ApiDocumentEndpoint({
    summary: 'Get product by ID',
    description: 'Returns an active product by numeric ID.',
    errors: [400, 404, 500],
  })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.products.findOne(id);
  }
}

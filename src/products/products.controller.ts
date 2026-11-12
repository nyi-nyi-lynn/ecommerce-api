import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { QueryProductsDto } from './dto/query-products.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsService } from './products.service.js';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import { StripEmptyMultipartFieldsInterceptor } from '../common/interceptors/strip-empty-multipart-fields.interceptor.js';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import { MAX_PRODUCT_IMAGE_BYTES } from '../modules/uploads/uploads.service.js';

const PRODUCT_ID_EXAMPLE = '550e8400-e29b-41d4-a716-446655440000';
const CATEGORY_ID_EXAMPLE = '11111111-1111-4111-8111-111111111111';
const BRAND_ID_EXAMPLE = '33333333-3333-4333-8333-333333333333';

const PRODUCT_EXAMPLE = {
  id: PRODUCT_ID_EXAMPLE,
  category: {
    id: CATEGORY_ID_EXAMPLE,
    name: 'Electronics',
    slug: 'electronics',
    imageUrl: null,
  },
  brand: {
    id: BRAND_ID_EXAMPLE,
    name: 'Samsung',
    slug: 'samsung',
    imageUrl: null,
  },
  name: 'Wireless Headphones',
  slug: 'wireless-headphones',
  sku: 'WH-1000',
  description: 'Over-ear wireless headphones.',
  price: '100000.00',
  originalPrice: '150000.00',
  discountPercentage: 33.33,
  imageUrl: null,
  imagePublicId: null,
  isActive: true,
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
};

const PUBLIC_PRODUCT_EXAMPLE = {
  ...PRODUCT_EXAMPLE,
  stock: {
    availableQuantity: 20,
    inStock: true,
    updatedAt: '2026-10-30T08:00:00.000Z',
  },
};

@Controller('products')
@ApiTags('Products')
@ApiExtraModels(CreateProductDto, UpdateProductDto)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('product:create')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Wireless Headphones' },
        slug: { type: 'string', example: 'wireless-headphones' },
        brandId: {
          type: 'string',
          format: 'uuid',
          nullable: true,
          example: BRAND_ID_EXAMPLE,
        },
        sku: { type: 'string', example: 'WH-1000' },
        description: {
          type: 'string',
          example: 'Over-ear wireless headphones.',
        },
        price: { type: 'number', example: 100000, minimum: 0.01 },
        originalPrice: {
          type: 'number',
          nullable: true,
          example: 150000,
          minimum: 0.01,
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
          example: CATEGORY_ID_EXAMPLE,
        },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 },
    }),
    StripEmptyMultipartFieldsInterceptor,
  )
  @ApiDocumentEndpoint({
    summary: 'Create product',
    description: `Creates a product; its category must exist. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: PRODUCT_EXAMPLE,
  })
  create(
    @Body() dto: CreateProductDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string | undefined,
  ) {
    return this.products.create(dto, image, userId);
  }

  @Patch(':id')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('product:update')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: PRODUCT_ID_EXAMPLE,
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 200 },
        slug: { type: 'string', maxLength: 220 },
        brandId: {
          type: 'string',
          format: 'uuid',
          nullable: true,
        },
        sku: { type: 'string', maxLength: 100 },
        description: {
          type: 'string',
          nullable: true,
        },
        price: { type: 'number', minimum: 0.01 },
        originalPrice: {
          type: 'number',
          nullable: true,
          minimum: 0.01,
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
        },
        isActive: { type: 'boolean' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 },
    }),
    StripEmptyMultipartFieldsInterceptor,
  )
  @ApiDocumentEndpoint({
    summary: 'Update product',
    description: `Updates product fields. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: PRODUCT_EXAMPLE,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string | undefined,
  ) {
    return this.products.update(id, dto, image, userId);
  }

  @Get()
  @ApiDocumentEndpoint({
    summary: 'List products',
    description:
      'Returns active products with database pagination, allowlisted sorting, category/brand/discount/price filters, name search, discount percentage, and customer-facing stock availability (`{ availableQuantity: 0, inStock: false }` when stock has not been initialized for the product).',
    errors: [400, 500],
    successExample: {
      items: [PUBLIC_PRODUCT_EXAMPLE],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  findAll(@Query() query: QueryProductsDto) {
    return this.products.findAll(query);
  }

  @Get('slug/:slug')
  @ApiDocumentEndpoint({
    summary: 'Get product by slug',
    description:
      'Returns an active product by its unique slug, including customer-facing stock availability (`{ availableQuantity: 0, inStock: false }` when stock has not been initialized for the product).',
    errors: [404, 500],
    successExample: PUBLIC_PRODUCT_EXAMPLE,
  })
  findBySlug(@Param('slug') slug: string) {
    return this.products.findBySlug(slug);
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    description: 'Product UUID.',
    type: String,
    format: 'uuid',
    example: PRODUCT_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Get product by ID',
    description:
      'Returns an active product by UUID, including customer-facing stock availability (`{ availableQuantity: 0, inStock: false }` when stock has not been initialized for the product).',
    errors: [400, 404, 500],
    successExample: PUBLIC_PRODUCT_EXAMPLE,
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id);
  }
}

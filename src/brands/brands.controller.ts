import {
  Body,
  Controller,
  Delete,
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
import { BrandsService } from './brands.service.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { QueryBrandsDto } from './dto/query-brands.dto.js';
import { UpdateBrandDto } from './dto/update-brand.dto.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
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
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import { MAX_PRODUCT_IMAGE_BYTES } from '../modules/uploads/uploads.service.js';

const BRAND_ID_EXAMPLE = '33333333-3333-4333-8333-333333333333';

const BRAND_EXAMPLE = {
  id: BRAND_ID_EXAMPLE,
  name: 'Samsung',
  slug: 'samsung',
  description: 'Global electronics and mobile manufacturer.',
  imageUrl: null,
  imagePublicId: null,
  isActive: true,
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
};

@Controller('brands')
@ApiTags('Brands')
@ApiExtraModels(CreateBrandDto, UpdateBrandDto, QueryBrandsDto)
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @ApiDocumentEndpoint({
    summary: 'List active brands',
    description:
      'Returns active brands with database pagination, allowlisted sorting, and name search.',
    errors: [400, 500],
    successExample: {
      items: [BRAND_EXAMPLE],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  })
  findAll(@Query() query: QueryBrandsDto) {
    return this.brandsService.findAll(query);
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    description: 'Brand UUID.',
    type: String,
    format: 'uuid',
    example: BRAND_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Get brand details',
    description: 'Returns an active brand by UUID.',
    errors: [400, 404, 500],
    successExample: BRAND_EXAMPLE,
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.findOne(id);
  }

  @Post()
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('brand:create')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Samsung', maxLength: 150 },
        slug: { type: 'string', example: 'samsung', maxLength: 160 },
        description: {
          type: 'string',
          example: 'Global electronics and mobile manufacturer.',
        },
        isActive: { type: 'boolean', example: true },
        image: { type: 'string', format: 'binary' },
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
    summary: 'Create brand',
    description: `Creates a brand. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 409, 500],
    successExample: BRAND_EXAMPLE,
  })
  create(
    @Body() dto: CreateBrandDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string | undefined,
  ) {
    return this.brandsService.create(dto, image, userId);
  }

  @Patch(':id')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('brand:update')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    description: 'Brand UUID.',
    type: String,
    format: 'uuid',
    example: BRAND_ID_EXAMPLE,
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Samsung', maxLength: 150 },
        slug: { type: 'string', example: 'samsung', maxLength: 160 },
        description: {
          type: 'string',
          example: 'Global electronics and mobile manufacturer.',
        },
        isActive: { type: 'boolean', example: true },
        image: { type: 'string', format: 'binary' },
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
    summary: 'Update brand',
    description: `Updates brand fields. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: BRAND_EXAMPLE,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string | undefined,
  ) {
    return this.brandsService.update(id, dto, image, userId);
  }

  @Delete(':id')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('brand:delete')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    description: 'Brand UUID.',
    type: String,
    format: 'uuid',
    example: BRAND_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Delete brand',
    description: `Deletes a brand if its relations permit. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: BRAND_EXAMPLE,
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.remove(id);
  }
}

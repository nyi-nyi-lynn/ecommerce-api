import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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

const CATEGORY_ID_EXAMPLE = '550e8400-e29b-41d4-a716-446655440000';

const CATEGORY_EXAMPLE = {
  id: CATEGORY_ID_EXAMPLE,
  name: 'Electronics',
  slug: 'electronics',
  description: 'Electronic devices and accessories.',
  imageUrl: null,
  imagePublicId: null,
  isActive: true,
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
};

@Controller('categories')
@ApiTags('Categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // GET /api/categories
  @Get()
  @ApiDocumentEndpoint({
    summary: 'List active categories',
    description: 'Returns active categories for public catalog browsing.',
    errors: [500],
    successExample: [CATEGORY_EXAMPLE],
  })
  findAll() {
    return this.categoriesService.findAll();
  }

  // GET /api/categories/:id
  @Get(':id')
  @ApiParam({
    name: 'id',
    description: 'Category UUID.',
    type: String,
    format: 'uuid',
    example: CATEGORY_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Get category details',
    description: 'Returns an active category by UUID.',
    errors: [400, 404, 500],
    successExample: CATEGORY_EXAMPLE,
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findOne(id);
  }

  // POST /api/categories
  @Post()
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('category:create')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
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
  )
  @ApiDocumentEndpoint({
    summary: 'Create category',
    description: `Creates a category. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 409, 500],
    successExample: CATEGORY_EXAMPLE,
  })
  create(
    @Body() dto: CreateCategoryDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string | undefined,
  ) {
    return this.categoriesService.create(dto, image, userId);
  }

  // PATCH /api/categories/:id
  @Patch(':id')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('category:update')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    description: 'Category UUID.',
    type: String,
    format: 'uuid',
    example: CATEGORY_ID_EXAMPLE,
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
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
  )
  @ApiDocumentEndpoint({
    summary: 'Update category',
    description: `Updates category fields. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
    successExample: CATEGORY_EXAMPLE,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string | undefined,
  ) {
    return this.categoriesService.update(id, dto, image, userId);
  }

  // DELETE /api/categories/:id
  @Delete(':id')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('category:delete')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    description: 'Category UUID.',
    type: String,
    format: 'uuid',
    example: CATEGORY_ID_EXAMPLE,
  })
  @ApiDocumentEndpoint({
    summary: 'Delete category',
    description: `Deletes a category if its relations permit. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
    successExample: CATEGORY_EXAMPLE,
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.remove(id);
  }
}

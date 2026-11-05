import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import type { Request } from 'express';
import { MAX_PRODUCT_IMAGE_BYTES } from '../modules/uploads/uploads.service.js';

type RequestWithUser = Request & { user?: { sub?: number } };

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
  })
  findAll() {
    return this.categoriesService.findAll();
  }

  // GET /api/categories/:id
  @Get(':id')
  @ApiDocumentEndpoint({
    summary: 'Get category details',
    description: 'Returns an active category by numeric ID.',
    errors: [400, 404, 500],
  })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.findOne(id);
  }

  // POST /api/categories
  @Post()
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
  })
  create(
    @Body() dto: CreateCategoryDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.categoriesService.create(dto, image, request.user?.sub);
  }

  // PATCH /api/categories/:id
  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('category:update')
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
    summary: 'Update category',
    description: `Updates category fields. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.categoriesService.update(id, dto, image, request.user?.sub);
  }

  // DELETE /api/categories/:id
  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('category:delete')
  @ApiBearerAuth()
  @ApiDocumentEndpoint({
    summary: 'Delete category',
    description: `Deletes a category if its relations permit. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.remove(id);
  }
}

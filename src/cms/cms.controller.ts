import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import multer from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import { StripEmptyMultipartFieldsInterceptor } from '../common/interceptors/strip-empty-multipart-fields.interceptor.js';
import { MAX_PRODUCT_IMAGE_BYTES } from '../modules/uploads/uploads.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CmsService } from './cms.service.js';
import { CreateCmsDocumentDto } from './dto/create-cms-document.dto.js';
import { UpdateCmsDocumentDto } from './dto/update-cms-document.dto.js';
import { QueryCmsDocumentsDto } from './dto/query-cms-documents.dto.js';
import { CreateCmsSectionDto } from './dto/create-cms-section.dto.js';
import { UpdateCmsSectionDto } from './dto/update-cms-section.dto.js';
import { SetCmsSectionVisibilityDto } from './dto/set-cms-section-visibility.dto.js';
import { CreateCmsSectionItemDto } from './dto/create-cms-section-item.dto.js';
import { UpdateCmsSectionItemDto } from './dto/update-cms-section-item.dto.js';
import { ReorderCmsContentDto } from './dto/reorder-cms-content.dto.js';

type CmsRequest = Request & { rbacPermissions?: Set<string> };
const uploadInterceptor = () =>
  FileInterceptor('image', {
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 },
  });

@Controller('cms')
@ApiTags('CMS Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiExtraModels(
  CreateCmsDocumentDto,
  UpdateCmsDocumentDto,
  QueryCmsDocumentsDto,
  CreateCmsSectionDto,
  UpdateCmsSectionDto,
  CreateCmsSectionItemDto,
  UpdateCmsSectionItemDto,
  ReorderCmsContentDto,
)
export class CmsController {
  constructor(private readonly cms: CmsService) {}

  @Get('documents')
  @RequirePermissions('cms:read')
  @ApiDocumentEndpoint({
    summary: 'List CMS documents',
    description: `Lists documents with bounded pagination and optional status/search filters. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 500],
    successExample: {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  })
  listDocuments(@Query() query: QueryCmsDocumentsDto) {
    return this.cms.listDocuments(query);
  }

  @Post('documents')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:create')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['key', 'title'],
      properties: {
        key: { type: 'string' },
        title: { type: 'string' },
        seoTitle: { type: 'string', nullable: true },
        seoDescription: { type: 'string', nullable: true },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(uploadInterceptor())
  @ApiDocumentEndpoint({
    summary: 'Create CMS document',
    description: `Creates a DRAFT document. An optional Open Graph image upload also requires media:upload. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 409, 413, 500],
  })
  createDocument(
    @Body() dto: CreateCmsDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('sub') actorId: string,
    @Req() request: CmsRequest,
  ) {
    this.assertUploadPermission(request, file);
    return this.cms.createDocument(dto, file, actorId);
  }

  @Get('documents/by-key/:key')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'key', example: 'home' })
  @ApiDocumentEndpoint({
    summary: 'Get CMS document by key',
    description: `Returns admin document metadata by key. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  getDocumentByKey(@Param('key') key: string) {
    return this.cms.getDocumentByKey(key);
  }

  @Get('documents/:documentId')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Get CMS document and content',
    description: `Returns the document with ordered sections and items. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  getDocument(@Param('documentId', ParseUUIDPipe) id: string) {
    return this.cms.getDocument(id);
  }

  @Patch('documents/:documentId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 150 },
        seoTitle: { type: 'string', maxLength: 70, nullable: true },
        seoDescription: { type: 'string', maxLength: 160, nullable: true },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(uploadInterceptor(), StripEmptyMultipartFieldsInterceptor)
  @ApiDocumentEndpoint({
    summary: 'Update CMS document content metadata',
    description: `Updates the existing document directly; a published page remains published. Optional Open Graph upload requires media:upload. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 413, 500],
  })
  updateDocument(
    @Param('documentId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('sub') actorId: string,
    @Req() request: CmsRequest,
  ) {
    this.assertUploadPermission(request, file);
    return this.cms.updateDocument(id, dto, file, actorId);
  }

  @Delete('documents/:documentId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:delete')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Delete CMS document and nested content',
    description: `Deletes a document and its sections/items. Referenced Cloudinary assets are removed only after checking remaining CMS references. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  deleteDocument(@Param('documentId', ParseUUIDPipe) id: string) {
    return this.cms.deleteDocument(id);
  }

  @Get('documents/:documentId/sections')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'List document sections',
    description: `Lists sections in deterministic order. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  listSections(@Param('documentId', ParseUUIDPipe) id: string) {
    return this.cms.listSections(id);
  }

  @Post('documents/:documentId/sections')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:create')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['key', 'type', 'position', 'content'],
      properties: {
        key: { type: 'string' },
        type: { type: 'string' },
        position: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
        isVisible: { type: 'boolean' },
        content: {
          oneOf: [
            { type: 'object', additionalProperties: true },
            { type: 'string', format: 'json' },
          ],
        },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(uploadInterceptor())
  @ApiDocumentEndpoint({
    summary: 'Create document section',
    description: `Creates a section directly under a document; image upload additionally requires media:upload. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  createSection(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CreateCmsSectionDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('sub') actorId: string,
    @Req() request: CmsRequest,
  ) {
    this.assertUploadPermission(request, file);
    return this.cms.createSection(documentId, dto, file, actorId);
  }

  @Patch('documents/:documentId/sections/reorder')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Reorder document sections',
    description: `Moves every section to the supplied order atomically. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  reorderSections(
    @Param('documentId', ParseUUIDPipe) id: string,
    @Body() dto: ReorderCmsContentDto,
  ) {
    return this.cms.reorderSections(id, dto.ids);
  }

  @Get('sections/:sectionId')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Get CMS section',
    description: `Returns a section and ordered items. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  getSection(@Param('sectionId', ParseUUIDPipe) id: string) {
    return this.cms.getSection(id);
  }

  @Patch('sections/:sectionId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        type: { type: 'string' },
        position: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
        isVisible: { type: 'boolean' },
        content: {
          oneOf: [
            { type: 'object', additionalProperties: true },
            { type: 'string', format: 'json' },
          ],
        },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(uploadInterceptor(), StripEmptyMultipartFieldsInterceptor)
  @ApiDocumentEndpoint({
    summary: 'Update CMS section',
    description: `Updates the existing section. Optional image replacement requires media:upload. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  updateSection(
    @Param('sectionId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsSectionDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('sub') actorId: string,
    @Req() request: CmsRequest,
  ) {
    this.assertUploadPermission(request, file);
    return this.cms.updateSection(id, dto, file, actorId);
  }

  @Patch('sections/:sectionId/visibility')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Set section visibility',
    description: `Changes section visibility. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  setSectionVisibility(
    @Param('sectionId', ParseUUIDPipe) id: string,
    @Body() dto: SetCmsSectionVisibilityDto,
  ) {
    return this.cms.setSectionVisibility(id, dto.isVisible);
  }

  @Delete('sections/:sectionId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:delete')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Delete section and nested items',
    description: `Deletes a section and its items. Referenced images are cleaned up only when unused. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  deleteSection(@Param('sectionId', ParseUUIDPipe) id: string) {
    return this.cms.deleteSection(id);
  }

  @Get('sections/:sectionId/items')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'List section items',
    description: `Lists items in deterministic order. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  listItems(@Param('sectionId', ParseUUIDPipe) id: string) {
    return this.cms.listItems(id);
  }

  @Post('sections/:sectionId/items')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:create')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Create section item',
    description: `Creates a repeatable item. ${DYNAMIC_RBAC_DESCRIPTION}`,
    successStatus: 201,
    errors: [400, 401, 403, 404, 409, 500],
  })
  createItem(
    @Param('sectionId', ParseUUIDPipe) id: string,
    @Body() dto: CreateCmsSectionItemDto,
  ) {
    return this.cms.createItem(id, dto);
  }

  @Patch('sections/:sectionId/items/reorder')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Reorder section items',
    description: `Moves every item to the supplied order atomically. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  reorderItems(
    @Param('sectionId', ParseUUIDPipe) id: string,
    @Body() dto: ReorderCmsContentDto,
  ) {
    return this.cms.reorderItems(id, dto.ids);
  }

  @Get('items/:itemId')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Get section item',
    description: `Returns one section item. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  getItem(@Param('itemId', ParseUUIDPipe) id: string) {
    return this.cms.getItem(id);
  }

  @Patch('items/:itemId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Update section item',
    description: `Updates item content; omitted nullable fields remain unchanged and explicit null clears them. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  updateItem(
    @Param('itemId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsSectionItemDto,
  ) {
    return this.cms.updateItem(id, dto);
  }

  @Delete('items/:itemId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:delete')
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Delete section item',
    description: `Deletes one item. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  deleteItem(@Param('itemId', ParseUUIDPipe) id: string) {
    return this.cms.deleteItem(id);
  }

  private assertUploadPermission(
    request: CmsRequest,
    file?: Express.Multer.File,
  ) {
    if (file && !request.rbacPermissions?.has('media:upload')) {
      throw new ForbiddenException(
        'You do not have permission to upload media.',
      );
    }
  }
}

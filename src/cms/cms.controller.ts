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
import { CreateCmsRevisionDto } from './dto/create-cms-revision.dto.js';
import { UpdateCmsRevisionDto } from './dto/update-cms-revision.dto.js';
import { QueryCmsRevisionsDto } from './dto/query-cms-revisions.dto.js';
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
  CreateCmsRevisionDto,
  UpdateCmsRevisionDto,
  QueryCmsRevisionsDto,
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
    description: `Lists documents with bounded pagination and optional key/title search. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 500],
    successExample: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
  })
  listDocuments(@Query() query: QueryCmsDocumentsDto) {
    return this.cms.listDocuments(query);
  }

  @Post('documents')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:create')
  @ApiDocumentEndpoint({ summary: 'Create CMS document', description: `Creates a CMS document. ${DYNAMIC_RBAC_DESCRIPTION}`, successStatus: 201, errors: [400, 401, 403, 409, 500] })
  createDocument(@Body() dto: CreateCmsDocumentDto) {
    return this.cms.createDocument(dto);
  }

  @Get('documents/by-key/:key')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'key', example: 'home', description: 'Stable CMS document key.' })
  @ApiDocumentEndpoint({ summary: 'Get CMS document by key', description: `Returns document metadata by key. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [401, 403, 404, 500] })
  getDocumentByKey(@Param('key') key: string) {
    return this.cms.getDocumentByKey(key);
  }

  @Get('documents/:documentId')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Get CMS document', description: `Returns document metadata by UUID. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500] })
  getDocument(@Param('documentId', ParseUUIDPipe) id: string) {
    return this.cms.getDocument(id);
  }

  @Patch('documents/:documentId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Update CMS document metadata', description: `Updates a document title. Document keys remain stable. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500] })
  updateDocument(@Param('documentId', ParseUUIDPipe) id: string, @Body() dto: UpdateCmsDocumentDto) {
    return this.cms.updateDocument(id, dto);
  }

  @Delete('documents/:documentId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:delete')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Delete empty CMS document', description: `Deletes a document only when it has no revision history. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [401, 403, 404, 409, 500] })
  deleteDocument(@Param('documentId', ParseUUIDPipe) id: string) {
    return this.cms.deleteDocument(id);
  }

  @Get('documents/:documentId/revisions')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'List document revisions', description: `Returns paginated revision history. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500], successExample: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } })
  listRevisions(@Param('documentId', ParseUUIDPipe) id: string, @Query() query: QueryCmsRevisionsDto) {
    return this.cms.listRevisions(id, query);
  }

  @Post('documents/:documentId/revisions')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:create')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { seoTitle: { type: 'string', maxLength: 70 }, seoDescription: { type: 'string', maxLength: 160 }, image: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(uploadInterceptor())
  @ApiDocumentEndpoint({ summary: 'Create DRAFT revision', description: `Creates the next sequential DRAFT revision. At most one draft exists per document. Optional Open Graph image uploads require media:upload. ${DYNAMIC_RBAC_DESCRIPTION}`, successStatus: 201, errors: [400, 401, 403, 404, 409, 413, 500] })
  createRevision(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CreateCmsRevisionDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('sub') actorId: string,
    @Req() request: CmsRequest,
  ) {
    this.assertUploadPermission(request, file);
    return this.cms.createRevision(documentId, dto, file, actorId);
  }

  @Get('revisions/:revisionId')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Get CMS revision', description: `Returns revision metadata, sections, and items. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500] })
  getRevision(@Param('revisionId', ParseUUIDPipe) id: string) {
    return this.cms.getRevision(id);
  }

  @Patch('revisions/:revisionId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { seoTitle: { type: 'string', maxLength: 70, nullable: true }, seoDescription: { type: 'string', maxLength: 160, nullable: true }, image: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(uploadInterceptor(), StripEmptyMultipartFieldsInterceptor)
  @ApiDocumentEndpoint({ summary: 'Update DRAFT revision metadata', description: `Edits SEO fields and optionally replaces the Open Graph image. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 413, 500] })
  updateRevision(@Param('revisionId', ParseUUIDPipe) id: string, @Body() dto: UpdateCmsRevisionDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('sub') actorId: string, @Req() request: CmsRequest) {
    this.assertUploadPermission(request, file);
    return this.cms.updateRevision(id, dto, file, actorId);
  }

  @Delete('revisions/:revisionId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:delete')
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Delete DRAFT revision', description: `Deletes a DRAFT and its draft sections/items; published and archived revisions cannot be deleted. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 500] })
  deleteRevision(@Param('revisionId', ParseUUIDPipe) id: string) {
    return this.cms.deleteRevision(id);
  }

  @Get('revisions/:revisionId/sections')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'List revision sections', description: `Lists sections in deterministic order. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500] })
  listSections(@Param('revisionId', ParseUUIDPipe) id: string) {
    return this.cms.listSections(id);
  }

  @Post('revisions/:revisionId/sections')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:create')
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', required: ['key', 'type', 'position', 'content'], properties: { key: { type: 'string' }, type: { type: 'string' }, position: { type: 'integer', minimum: 0, maximum: 2_147_483_647 }, isVisible: { type: 'boolean' }, content: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string', format: 'json' }], description: 'Structured JSON object; use a JSON-encoded string for multipart requests.' }, image: { type: 'string', format: 'binary', description: 'Optional JPEG, PNG, WebP, or AVIF image up to 5 MB.' } } } })
  @UseInterceptors(uploadInterceptor())
  @ApiDocumentEndpoint({ summary: 'Create section in DRAFT revision', description: `Creates a section; image upload requires media:upload. ${DYNAMIC_RBAC_DESCRIPTION}`, successStatus: 201, errors: [400, 401, 403, 404, 409, 413, 500] })
  createSection(@Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: CreateCmsSectionDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('sub') actorId: string, @Req() request: CmsRequest) {
    this.assertUploadPermission(request, file);
    return this.cms.createSection(revisionId, dto, file, actorId);
  }

  @Patch('revisions/:revisionId/sections/reorder')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'revisionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Reorder revision sections', description: `Moves every section to the supplied order atomically. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 500] })
  reorderSections(@Param('revisionId', ParseUUIDPipe) id: string, @Body() dto: ReorderCmsContentDto) {
    return this.cms.reorderSections(id, dto.ids);
  }

  @Get('sections/:sectionId')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Get CMS section', description: `Returns a section and its items. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500] })
  getSection(@Param('sectionId', ParseUUIDPipe) id: string) {
    return this.cms.getSection(id);
  }

  @Patch('sections/:sectionId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { key: { type: 'string' }, type: { type: 'string' }, position: { type: 'integer', minimum: 0, maximum: 2_147_483_647 }, isVisible: { type: 'boolean' }, content: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string', format: 'json' }], description: 'Structured JSON object; use a JSON-encoded string for multipart requests.' }, image: { type: 'string', format: 'binary', description: 'Optional JPEG, PNG, WebP, or AVIF image up to 5 MB.' } } } })
  @UseInterceptors(uploadInterceptor(), StripEmptyMultipartFieldsInterceptor)
  @ApiDocumentEndpoint({ summary: 'Update DRAFT section', description: `Updates section fields and optionally replaces its image. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 413, 500] })
  updateSection(@Param('sectionId', ParseUUIDPipe) id: string, @Body() dto: UpdateCmsSectionDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('sub') actorId: string, @Req() request: CmsRequest) {
    this.assertUploadPermission(request, file);
    return this.cms.updateSection(id, dto, file, actorId);
  }

  @Patch('sections/:sectionId/visibility')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Set section visibility', description: `Changes visibility for a DRAFT section. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 500] })
  setSectionVisibility(@Param('sectionId', ParseUUIDPipe) id: string, @Body() dto: SetCmsSectionVisibilityDto) {
    return this.cms.setSectionVisibility(id, dto.isVisible);
  }

  @Delete('sections/:sectionId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:delete')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Delete DRAFT section', description: `Deletes a section and its items from a DRAFT revision. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 500] })
  deleteSection(@Param('sectionId', ParseUUIDPipe) id: string) {
    return this.cms.deleteSection(id);
  }

  @Get('sections/:sectionId/items')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'List section items', description: `Lists repeatable items in deterministic order. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500] })
  listItems(@Param('sectionId', ParseUUIDPipe) id: string) {
    return this.cms.listItems(id);
  }

  @Post('sections/:sectionId/items')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:create')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Create section item', description: `Creates a repeatable item in a DRAFT revision. ${DYNAMIC_RBAC_DESCRIPTION}`, successStatus: 201, errors: [400, 401, 403, 404, 409, 500] })
  createItem(@Param('sectionId', ParseUUIDPipe) id: string, @Body() dto: CreateCmsSectionItemDto) {
    return this.cms.createItem(id, dto);
  }

  @Patch('sections/:sectionId/items/reorder')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Reorder section items', description: `Moves every item to the supplied order atomically. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 500] })
  reorderItems(@Param('sectionId', ParseUUIDPipe) id: string, @Body() dto: ReorderCmsContentDto) {
    return this.cms.reorderItems(id, dto.ids);
  }

  @Get('items/:itemId')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Get section item', description: `Returns one section item. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 500] })
  getItem(@Param('itemId', ParseUUIDPipe) id: string) {
    return this.cms.getItem(id);
  }

  @Patch('items/:itemId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Update section item', description: `Updates item content; omitted nullable fields are unchanged and explicit null clears them. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 500] })
  updateItem(@Param('itemId', ParseUUIDPipe) id: string, @Body() dto: UpdateCmsSectionItemDto) {
    return this.cms.updateItem(id, dto);
  }

  @Delete('items/:itemId')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:delete')
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiDocumentEndpoint({ summary: 'Delete section item', description: `Deletes an item from a DRAFT revision. ${DYNAMIC_RBAC_DESCRIPTION}`, errors: [400, 401, 403, 404, 409, 500] })
  deleteItem(@Param('itemId', ParseUUIDPipe) id: string) {
    return this.cms.deleteItem(id);
  }

  private assertUploadPermission(request: CmsRequest, file?: Express.Multer.File) {
    if (file && !request.rbacPermissions?.has('media:upload')) {
      throw new ForbiddenException('You do not have permission to upload media.');
    }
  }
}

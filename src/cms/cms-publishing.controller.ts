import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
import {
  ApiDocumentEndpoint,
  DYNAMIC_RBAC_DESCRIPTION,
} from '../common/swagger/swagger.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CmsService } from './cms.service.js';

@Controller('admin/cms/documents')
@ApiTags('CMS Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CmsPublishingController {
  constructor(private readonly cms: CmsService) {}

  @Post(':documentId/publish')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Publish CMS document',
    description: `Sets the document status to PUBLISHED. Repeated requests are idempotent. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  publish(
    @Param('documentId', ParseUUIDPipe) id: string,
    @CurrentUser('sub') publisherId: string,
  ) {
    return this.cms.publishDocument(id, publisherId);
  }

  @Post(':documentId/unpublish')
  @Throttle(RATE_LIMIT_POLICIES.ADMIN_WRITE)
  @RequirePermissions('cms:update')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Unpublish CMS document',
    description: `Returns the document to DRAFT and clears publishedAt. Repeated requests are idempotent. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  unpublish(@Param('documentId', ParseUUIDPipe) id: string) {
    return this.cms.unpublishDocument(id);
  }

  @Get(':documentId/preview')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Preview current CMS document',
    description: `Returns the current document and its editable content regardless of publication status. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  preview(@Param('documentId', ParseUUIDPipe) id: string) {
    return this.cms.previewDocument(id);
  }
}

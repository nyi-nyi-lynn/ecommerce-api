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
    summary: 'Publish the current CMS draft',
    description: `Publishes the document's DRAFT revision, archiving the previous PUBLISHED revision atomically. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 409, 500],
  })
  publish(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser('sub') publisherId: string,
  ) {
    return this.cms.publishDocument(documentId, publisherId);
  }

  @Get(':documentId/preview')
  @RequirePermissions('cms:read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiDocumentEndpoint({
    summary: 'Preview a CMS draft',
    description: `Returns only the current DRAFT revision for an authorized preview. ${DYNAMIC_RBAC_DESCRIPTION}`,
    errors: [400, 401, 403, 404, 500],
  })
  preview(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.cms.getDraftPreview(documentId);
  }
}

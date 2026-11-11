import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiDocumentEndpoint } from '../common/swagger/swagger.decorators.js';
import { QueryCmsDocumentsDto } from './dto/query-cms-documents.dto.js';
import { CmsService } from './cms.service.js';

@Controller('cms/pages')
@ApiTags('Public CMS')
export class CmsPublicController {
  constructor(private readonly cms: CmsService) {}

  @Get()
  @ApiDocumentEndpoint({
    summary: 'List published CMS pages',
    description: 'Returns paginated document metadata for pages with a current PUBLISHED revision.',
    errors: [400, 500],
    successExample: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
  })
  list(@Query() query: QueryCmsDocumentsDto) {
    return this.cms.listPublishedPages(query);
  }

  @Get(':key')
  @ApiDocumentEndpoint({
    summary: 'Get a published CMS page',
    description: 'Returns only the current PUBLISHED revision, visible sections, and ordered section items.',
    errors: [400, 404, 500],
  })
  get(@Param('key') key: string) {
    return this.cms.getPublishedPage(key);
  }
}

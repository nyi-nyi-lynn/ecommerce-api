import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { CmsRevisionStatus } from '../../generated/prisma/enums.js';

export class QueryCmsRevisionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CmsRevisionStatus)
  @ApiPropertyOptional({ enum: CmsRevisionStatus })
  status?: CmsRevisionStatus;
}

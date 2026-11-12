import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';
import { CmsDocumentStatus } from '../../generated/prisma/enums.js';

export class QueryCmsDocumentsDto extends PaginationQueryDto {
  @TransformTrimmedString()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({ description: 'Search document keys and titles.' })
  search?: string;

  @IsOptional()
  @IsEnum(CmsDocumentStatus)
  @ApiPropertyOptional({ enum: CmsDocumentStatus })
  status?: CmsDocumentStatus;
}

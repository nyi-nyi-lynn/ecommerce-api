import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

export class QueryCmsDocumentsDto extends PaginationQueryDto {
  @TransformTrimmedString()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({ description: 'Search document keys and titles.' })
  search?: string;
}

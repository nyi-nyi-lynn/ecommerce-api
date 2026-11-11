import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { TransformTrimmedString } from '../../common/transformers/dto-transforms.util.js';

export class CreateCmsDocumentDto {
  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  @ApiProperty({
    description: 'Stable lowercase document key; new page keys are supported.',
    example: 'home',
    maxLength: 100,
  })
  key!: string;

  @TransformTrimmedString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @ApiProperty({ example: 'Home Page', maxLength: 150 })
  title!: string;
}

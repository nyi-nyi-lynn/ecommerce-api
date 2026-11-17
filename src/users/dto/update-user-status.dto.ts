import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { UserStatus } from '../../generated/prisma/client.js';

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  @ApiProperty({
    description: 'Target account lifecycle status.',
    enum: UserStatus,
    example: UserStatus.SUSPENDED,
  })
  status!: UserStatus;
}

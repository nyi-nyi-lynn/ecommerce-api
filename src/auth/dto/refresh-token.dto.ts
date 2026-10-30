import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @ApiProperty({
    description: 'Refresh token returned by login or refresh.',
    example: 'opaque-refresh-token',
    format: 'password',
    maxLength: 128,
  })
  refreshToken: string;
}

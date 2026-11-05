import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiDocumentEndpoint } from '../common/swagger/swagger.decorators.js';
import { CurrentUser } from './decorators/current-user.decorator.js';

const AUTH_USER_EXAMPLE = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Aye Aye',
  email: 'customer@example.com',
  phone: null,
  role: 'CUSTOMER',
  createdAt: '2026-10-30T08:00:00.000Z',
};

const AUTH_SESSION_EXAMPLE = {
  user: AUTH_USER_EXAMPLE,
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.signature',
  refreshToken:
    '550e8400-e29b-41d4-a716-446655440000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
};

@Controller('auth')
@ApiTags('Authentication')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiDocumentEndpoint({
    summary: 'Register a customer',
    description:
      'Creates a customer account. Password hashes are never returned.',
    successStatus: 201,
    errors: [400, 409, 500],
    successExample: AUTH_SESSION_EXAMPLE,
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiDocumentEndpoint({
    summary: 'Log in',
    description:
      'Authenticates credentials and returns an access token and refresh token.',
    successStatus: 201,
    errors: [400, 401, 500],
    successExample: AUTH_SESSION_EXAMPLE,
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiDocumentEndpoint({
    summary: 'Refresh tokens',
    description: 'Rotates a valid refresh token and returns a new token pair.',
    successStatus: 201,
    errors: [400, 401, 500],
    successExample: AUTH_SESSION_EXAMPLE,
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDocumentEndpoint({
    summary: 'Log out',
    description:
      'Revokes the refresh-token family represented by the supplied token.',
    successStatus: 204,
    errors: [400, 401, 500],
  })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiDocumentEndpoint({
    summary: 'Get current user',
    description: 'Returns the profile for the authenticated JWT subject.',
    errors: [401, 404, 500],
    successExample: {
      ...AUTH_USER_EXAMPLE,
      isActive: true,
    },
  })
  me(@CurrentUser('sub') userId: string) {
    return this.authService.getProfile(userId);
  }
}

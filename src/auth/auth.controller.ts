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
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_POLICIES } from '../common/rate-limit/rate-limit.constants.js';
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

const AUTH_LOGIN_EXAMPLE = {
  user: {
    ...AUTH_USER_EXAMPLE,
    roleId: '550e8400-e29b-41d4-a716-446655440001',
    isActive: true,
    updatedAt: '2026-10-30T08:00:00.000Z',
  },
  permissions: ['category:read', 'product:read'],
  accessToken: AUTH_SESSION_EXAMPLE.accessToken,
  refreshToken: AUTH_SESSION_EXAMPLE.refreshToken,
};

const AUTH_PROFILE_EXAMPLE = {
  user: {
    ...AUTH_USER_EXAMPLE,
    roleId: '550e8400-e29b-41d4-a716-446655440001',
    isActive: true,
    updatedAt: '2026-10-30T08:00:00.000Z',
  },
  permissions: ['category:read', 'product:read'],
};

@Controller('auth')
@ApiTags('Authentication')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(RATE_LIMIT_POLICIES.AUTH_STRICT)
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
  @Throttle(RATE_LIMIT_POLICIES.AUTH_STRICT)
  @ApiDocumentEndpoint({
    summary: 'Log in',
    description:
      'Authenticates credentials and returns the current role permissions from the database with an access token and refresh token. Permissions are for frontend UI rendering; backend authorization continues to check current database permissions.',
    successStatus: 201,
    errors: [400, 401, 500],
    successExample: AUTH_LOGIN_EXAMPLE,
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Throttle(RATE_LIMIT_POLICIES.AUTH_SESSION)
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
  @Throttle(RATE_LIMIT_POLICIES.AUTH_SESSION)
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

  @Post('verify-email')
  @Throttle(RATE_LIMIT_POLICIES.AUTH_STRICT)
  @HttpCode(HttpStatus.OK)
  @ApiDocumentEndpoint({
    summary: 'Verify email address',
    description:
      'Consumes a single-use email verification token and marks the user email as verified.',
    successStatus: 200,
    errors: [400, 429, 500],
    successExample: {
      verified: true,
      emailVerifiedAt: '2026-11-19T10:00:00.000Z',
    },
  })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Throttle(RATE_LIMIT_POLICIES.AUTH_EMAIL_ACTION)
  @HttpCode(HttpStatus.OK)
  @ApiDocumentEndpoint({
    summary: 'Resend verification email',
    description:
      'Issues a fresh email verification link for unverified active accounts. Always returns a generic response to prevent email enumeration.',
    successStatus: 200,
    errors: [400, 429, 500],
    successExample: {
      message:
        'If an eligible account exists for this email, a verification link has been sent.',
    },
  })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @Throttle(RATE_LIMIT_POLICIES.AUTH_EMAIL_ACTION)
  @HttpCode(HttpStatus.OK)
  @ApiDocumentEndpoint({
    summary: 'Request password reset',
    description:
      'Generates a single-use password reset token and emails a reset link when an active account matches. Always returns a generic response.',
    successStatus: 200,
    errors: [400, 429, 500],
    successExample: {
      message:
        'If an account exists for this email, a password reset link has been sent.',
    },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Throttle(RATE_LIMIT_POLICIES.AUTH_STRICT)
  @HttpCode(HttpStatus.OK)
  @ApiDocumentEndpoint({
    summary: 'Reset password',
    description:
      'Validates a single-use reset token, updates the password hash, and revokes all active refresh-token sessions for the user.',
    successStatus: 200,
    errors: [400, 429, 500],
    successExample: {
      message:
        'Password has been reset successfully. Please log in with your new password.',
    },
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiDocumentEndpoint({
    summary: 'Get current user',
    description:
      'Returns the current profile and latest database-backed permission codes for the authenticated JWT subject. JWT role and permission claims are not used as the source of authorization.',
    errors: [401, 500],
    successExample: AUTH_PROFILE_EXAMPLE,
  })
  me(@CurrentUser('sub') userId: string) {
    return this.authService.getProfile(userId);
  }
}

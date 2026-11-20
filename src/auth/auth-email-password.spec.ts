import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailingService } from '../modules/mailing/mailing.service.js';
import { UserStatus } from '../generated/prisma/client.js';
import { GlobalExceptionFilter } from '../common/http/global-exception.filter.js';
import { ResponseInterceptor } from '../common/http/response.interceptor.js';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';

vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('$2b$12$new-hashed-password'),
  compare: vi.fn().mockResolvedValue(true),
}));

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('AuthService: Email Verification, Forgot Password & Reset Password', () => {
  const ROLE_ID = '00000000-0000-4000-8000-000000000002';
  const USER_ID = '00000000-0000-4000-8000-000000000007';

  let user: any;
  let verificationTokens: any[];
  let resetTokens: any[];
  let refreshTokens: any[];
  let prisma: any;
  let mailing: any;
  let service: AuthService;

  beforeEach(() => {
    user = {
      id: USER_ID,
      name: 'Aye Aye',
      email: 'customer@example.test',
      phone: null,
      passwordHash: '$2b$12$old-hash',
      roleId: ROLE_ID,
      isActive: true,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: null as Date | null,
      role: { name: 'CUSTOMER', permissions: [] },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    verificationTokens = [];
    resetTokens = [];
    refreshTokens = [
      {
        id: '00000000-0000-4000-8000-000000000099',
        userId: USER_ID,
        familyId: '00000000-0000-4000-8000-000000000088',
        tokenHash: sha256('existing-refresh'),
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
      },
    ];

    prisma = {
      role: {
        findUnique: vi.fn().mockResolvedValue({ id: ROLE_ID, name: 'CUSTOMER' }),
      },
      user: {
        findUnique: vi.fn(async ({ where }) => {
          if (where.email === user.email || where.id === user.id) return { ...user };
          return null;
        }),
        create: vi.fn(async ({ data }) => {
          user = { ...user, ...data, emailVerifiedAt: null };
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            emailVerifiedAt: user.emailVerifiedAt,
            role: { name: 'CUSTOMER' },
            createdAt: user.createdAt,
          };
        }),
        update: vi.fn(async ({ where, data }) => {
          if (where.id === user.id) {
            Object.assign(user, data);
          }
          return { ...user };
        }),
      },
      refreshToken: {
        create: vi.fn(async ({ data }) => {
          refreshTokens.push({ revokedAt: null, ...data });
          return data;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          let count = 0;
          for (const rt of refreshTokens) {
            if (
              (where.userId === undefined || rt.userId === where.userId) &&
              (where.revokedAt === undefined || rt.revokedAt === where.revokedAt)
            ) {
              Object.assign(rt, data);
              count++;
            }
          }
          return { count };
        }),
      },
      emailVerificationToken: {
        create: vi.fn(async ({ data }) => {
          const row = {
            id: `evt-${verificationTokens.length + 1}`,
            usedAt: null,
            createdAt: new Date(),
            ...data,
          };
          verificationTokens.push(row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const row = verificationTokens.find((t) => t.tokenHash === where.tokenHash);
          return row ? { ...row, user: { ...user } } : null;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          let count = 0;
          for (const row of verificationTokens) {
            const matches =
              (where.id === undefined || row.id === where.id) &&
              (where.userId === undefined || row.userId === where.userId) &&
              (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
              (where.usedAt === undefined || row.usedAt === where.usedAt) &&
              (where.expiresAt?.gt === undefined || row.expiresAt > where.expiresAt.gt);
            if (matches) {
              Object.assign(row, data);
              count++;
            }
          }
          return { count };
        }),
      },
      passwordResetToken: {
        create: vi.fn(async ({ data }) => {
          const row = {
            id: `prt-${resetTokens.length + 1}`,
            usedAt: null,
            createdAt: new Date(),
            ...data,
          };
          resetTokens.push(row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const row = resetTokens.find((t) => t.tokenHash === where.tokenHash);
          return row ? { ...row, user: { ...user } } : null;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          let count = 0;
          for (const row of resetTokens) {
            const matches =
              (where.id === undefined || row.id === where.id) &&
              (where.userId === undefined || row.userId === where.userId) &&
              (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
              (where.usedAt === undefined || row.usedAt === where.usedAt) &&
              (where.expiresAt?.gt === undefined || row.expiresAt > where.expiresAt.gt);
            if (matches) {
              Object.assign(row, data);
              count++;
            }
          }
          return { count };
        }),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    mailing = {
      getEmailVerificationTtlMinutes: vi.fn().mockReturnValue(1440),
      getPasswordResetTtlMinutes: vi.fn().mockReturnValue(30),
      buildFrontendUrl: vi.fn(
        (path: string, query?: Record<string, string>) =>
          `https://shop.example.test${path}?token=${query?.token ?? ''}`,
      ),
      sendWelcomeEmail: vi.fn().mockResolvedValue({ sent: true, provider: 'brevo' }),
      sendEmailVerification: vi.fn().mockResolvedValue({ sent: true, provider: 'brevo' }),
      sendPasswordReset: vi.fn().mockResolvedValue({ sent: true, provider: 'brevo' }),
    };

    service = new AuthService(
      prisma as PrismaService,
      { signAsync: vi.fn().mockResolvedValue('jwt-token') } as unknown as JwtService,
      {
        getOrThrow: vi.fn(() => 604800),
      } as unknown as ConfigService,
      mailing as MailingService,
    );
  });

  describe('Email Verification', () => {
    it('issues hashed verification token and sends email on registration', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const res = await service.register({
        name: 'Aye Aye',
        email: 'customer@example.test',
        password: 'Password123',
      });

      expect(res.user.isEmailVerified).toBe(false);
      expect(res.user.emailVerifiedAt).toBeNull();
      expect(verificationTokens).toHaveLength(1);
      expect(mailing.sendEmailVerification).toHaveBeenCalledTimes(1);
      expect(mailing.sendWelcomeEmail).toHaveBeenCalledTimes(1);

      const sentUrl = mailing.sendEmailVerification.mock.calls[0][1].verificationUrl as string;
      const rawToken = new URL(sentUrl).searchParams.get('token')!;
      expect(rawToken).toBeTruthy();
      expect(verificationTokens[0].tokenHash).toBe(sha256(rawToken));
      expect(verificationTokens[0].tokenHash).not.toBe(rawToken);
    });

    it('still succeeds registration if mailing provider fails', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      mailing.sendEmailVerification.mockRejectedValueOnce(new Error('provider down'));

      const res = await service.register({
        name: 'Aye Aye',
        email: 'customer@example.test',
        password: 'Password123',
      });
      expect(res.accessToken).toBe('jwt-token');
    });

    it('verifies a valid token once and rejects reuse, invalid, and expired tokens', async () => {
      const rawToken = 'valid-verification-token';
      verificationTokens.push({
        id: 'evt-valid',
        userId: USER_ID,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });

      const res = await service.verifyEmail(rawToken);
      expect(res.verified).toBe(true);
      expect(user.emailVerifiedAt).toBeInstanceOf(Date);

      // Already-used token rejected
      await expect(service.verifyEmail(rawToken)).rejects.toThrow(BadRequestException);

      // Invalid token rejected
      await expect(service.verifyEmail('non-existent')).rejects.toThrow(BadRequestException);

      // Expired token rejected
      const expiredToken = 'expired-verification-token';
      verificationTokens.push({
        id: 'evt-expired',
        userId: USER_ID,
        tokenHash: sha256(expiredToken),
        expiresAt: new Date(Date.now() - 1_000),
        usedAt: null,
      });
      await expect(service.verifyEmail(expiredToken)).rejects.toThrow(BadRequestException);
    });

    it('resends verification without leaking account existence', async () => {
      const existingRes = await service.resendVerification(user.email);
      const missingRes = await service.resendVerification('missing@example.test');

      expect(existingRes).toEqual(missingRes);
      expect(mailing.sendEmailVerification).toHaveBeenCalledTimes(1);
    });
  });

  describe('Forgot Password', () => {
    it('returns identical generic response for existing and non-existing accounts and invalidates old tokens', async () => {
      const r1 = await service.forgotPassword(user.email);
      const r2 = await service.forgotPassword('nobody@example.test');
      expect(r1).toEqual(r2);
      expect(resetTokens).toHaveLength(1);
      expect(mailing.sendPasswordReset).toHaveBeenCalledTimes(1);

      // Second request invalidates first token
      await service.forgotPassword(user.email);
      expect(resetTokens).toHaveLength(2);
      expect(resetTokens[0].usedAt).toBeInstanceOf(Date);
      expect(resetTokens[1].usedAt).toBeNull();
    });
  });

  describe('Reset Password', () => {
    it('updates password hash, consumes token, revokes all refresh tokens, and does not auto-login', async () => {
      const rawToken = 'valid-reset-token';
      resetTokens.push({
        id: 'prt-1',
        userId: USER_ID,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });

      const res = await service.resetPassword({
        token: rawToken,
        newPassword: 'NewSecurePassword123',
        confirmPassword: 'NewSecurePassword123',
      });

      expect(res.message).toContain('Password has been reset');
      expect((res as any).accessToken).toBeUndefined();
      expect((res as any).refreshToken).toBeUndefined();
      expect(user.passwordHash).toBe('$2b$12$new-hashed-password');
      expect(resetTokens[0].usedAt).toBeInstanceOf(Date);
      expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);

      // Reused token rejected
      await expect(
        service.resetPassword({
          token: rawToken,
          newPassword: 'AnotherPassword123',
          confirmPassword: 'AnotherPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects mismatched passwords, invalid tokens, and expired tokens', async () => {
      await expect(
        service.resetPassword({
          token: 'any',
          newPassword: 'Password123',
          confirmPassword: 'DifferentPassword123',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.resetPassword({
          token: 'invalid-token',
          newPassword: 'Password123',
          confirmPassword: 'Password123',
        }),
      ).rejects.toThrow(BadRequestException);

      const expired = 'expired-reset-token';
      resetTokens.push({
        id: 'prt-exp',
        userId: USER_ID,
        tokenHash: sha256(expired),
        expiresAt: new Date(Date.now() - 5_000),
        usedAt: null,
      });
      await expect(
        service.resetPassword({
          token: expired,
          newPassword: 'Password123',
          confirmPassword: 'Password123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents concurrent consumption of the same reset token', async () => {
      const rawToken = 'race-reset-token';
      resetTokens.push({
        id: 'prt-race',
        userId: USER_ID,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });

      const [first, second] = await Promise.allSettled([
        service.resetPassword({
          token: rawToken,
          newPassword: 'NewPassword123',
          confirmPassword: 'NewPassword123',
        }),
        service.resetPassword({
          token: rawToken,
          newPassword: 'NewPassword456',
          confirmPassword: 'NewPassword456',
        }),
      ]);

      const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
      const rejected = [first, second].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });
});

describe('Auth email/password HTTP endpoints & rate limiting', () => {
  let app: INestApplication;
  let authService: any;

  beforeEach(async () => {
    authService = {
      verifyEmail: vi.fn().mockResolvedValue({
        verified: true,
        emailVerifiedAt: new Date('2026-11-19T10:00:00Z'),
      }),
      resendVerification: vi.fn().mockResolvedValue({
        message: 'If an eligible account exists for this email, a verification link has been sent.',
      }),
      forgotPassword: vi.fn().mockResolvedValue({
        message: 'If an account exists for this email, a password reset link has been sent.',
      }),
      resetPassword: vi.fn().mockResolvedValue({
        message: 'Password has been reset successfully. Please log in with your new password.',
      }),
    };

    const hits = new Map<string, number>();
    const mockStorage = {
      increment: vi.fn(async (key: string, _ttl: number, limit: number) => {
        const count = (hits.get(key) ?? 0) + 1;
        hits.set(key, count);
        return {
          totalHits: count,
          timeToExpire: 60,
          isBlocked: count > limit,
          timeToBlockExpire: count > limit ? 180 : 0,
        };
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 15 }],
          storage: mockStorage as any,
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('validates reset-password confirmPassword mismatch at HTTP layer', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({
        token: 'some-token',
        newPassword: 'Password123',
        confirmPassword: 'MismatchPassword',
      });

    expect(res.status).toBe(400);
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('rate-limits repeated forgot-password and resend-verification requests (429)', async () => {
    const deviceCookie = 'device_id=0123456789abcdef0123456789abcdef';

    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .set('Cookie', deviceCookie)
        .send({ email: 'customer@example.test' });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .set('Cookie', deviceCookie)
      .send({ email: 'customer@example.test' });
    expect(blocked.status).toBe(429);
  });
});

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '../generated/prisma/client.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import {
  hashPassword,
  verifyPassword,
} from '../common/security/password.util.js';
import { MailingService } from '../modules/mailing/mailing.service.js';
import {
  DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES,
  DEFAULT_PASSWORD_RESET_TTL_MINUTES,
} from '../modules/mailing/mailing.constants.js';

const RESEND_VERIFICATION_GENERIC_MESSAGE =
  'If an eligible account exists for this email, a verification link has been sent.';
const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for this email, a password reset link has been sent.';
const INVALID_VERIFICATION_TOKEN_MESSAGE =
  'Invalid or expired verification token.';
const INVALID_RESET_TOKEN_MESSAGE =
  'Invalid or expired password reset token.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Optional() private readonly mailing?: MailingService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await hashPassword(dto.password);
    const customerRole = await this.prisma.role.findUnique({
      where: { name: 'CUSTOMER' },
    });
    if (!customerRole)
      throw new Error('CUSTOMER role is not configured. Run the RBAC seed.');
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        roleId: customerRole.id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        role: { select: { name: true } },
        createdAt: true,
      },
    });
    const tokens = await this.createSession(
      user.id,
      user.email,
      user.role.name,
    );
    await this.issueEmailVerification(user.id, user.email, user.name);
    if (this.mailing?.sendWelcomeEmail) {
      await this.mailing
        .sendWelcomeEmail(user.email, { recipientName: user.name })
        .catch(() => {
          this.logger.warn(
            `Welcome email dispatch failed for user ${user.id}; account remains active.`,
          );
        });
    }
    return {
      user: {
        ...user,
        emailVerifiedAt: user.emailVerifiedAt ?? null,
        isEmailVerified: Boolean(user.emailVerifiedAt),
        role: user.role.name,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        role: {
          select: {
            name: true,
            permissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });

    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Credential Error!!');
    }
    if (!this.isUserAccountActive(user)) {
      throw new UnauthorizedException(
        user.status === UserStatus.SUSPENDED
          ? 'Account is Suspended'
          : 'Account is Disabled',
      );
    }

    const tokens = await this.createSession(
      user.id,
      user.email,
      user.role.name,
    );
    const { passwordHash: _, role, ...safeUser } = user;
    return {
      user: {
        ...safeUser,
        emailVerifiedAt: user.emailVerifiedAt ?? null,
        isEmailVerified: Boolean(user.emailVerifiedAt),
        role: role.name,
      },
      permissions: this.permissionCodes(role),
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    const parsed = this.parseRefreshToken(refreshToken);
    if (!parsed) throw new UnauthorizedException('Invalid refresh token');
    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { id: parsed.selector },
      include: { user: { include: { role: { select: { name: true } } } } },
    });
    if (!record || !this.hashMatches(record.tokenHash, tokenHash)) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.revokedAt) {
      if (record.replacedByTokenId)
        await this.revokeFamily(record.userId, record.familyId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (
      record.expiresAt <= new Date() ||
      !this.isUserAccountActive(record.user)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const next = this.newRefreshToken();
    const now = new Date();
    const expiresAt = this.refreshExpiry(now);
    const safeUser = this.safeUser(record.user);
    const accessToken = await this.jwtService.signAsync({
      sub: record.user.id,
      email: record.user.email,
      role: record.user.role.name,
    });
    // READ COMMITTED makes a contending conditional UPDATE recheck the row
    // after the winner commits; the replay lookup below then runs outside the
    // transaction and observes that committed rotation.
    const rotated = await this.prisma
      .$transaction(
        async (tx) => {
          await tx.refreshToken.create({
            data: {
              id: next.selector,
              userId: record.userId,
              familyId: record.familyId,
              tokenHash: next.hash,
              expiresAt,
            },
          });
          const claimed = await tx.refreshToken.updateMany({
            where: {
              id: record.id,
              tokenHash: record.tokenHash,
              revokedAt: null,
              replacedByTokenId: null,
              expiresAt: { gt: now },
            },
            data: { revokedAt: now, replacedByTokenId: next.selector },
          });
          if (claimed.count !== 1) throw new Error('REFRESH_TOKEN_CLAIM_LOST');
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      )
      .catch(async (error: unknown) => {
        if (
          error instanceof Error &&
          error.message === 'REFRESH_TOKEN_CLAIM_LOST'
        ) {
          // A concurrent authentic reuse is replay: revoke this family only.
          const latest = await this.prisma.refreshToken.findUnique({
            where: { id: record.id },
          });
          if (
            latest?.revokedAt &&
            latest.replacedByTokenId &&
            this.hashMatches(latest.tokenHash, tokenHash)
          ) {
            await this.revokeFamily(record.userId, record.familyId);
          }
          throw new UnauthorizedException('Invalid refresh token');
        }
        throw error;
      });
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');
    return { user: safeUser, accessToken, refreshToken: next.value };
  }

  async logout(refreshToken: string): Promise<void> {
    const parsed = this.parseRefreshToken(refreshToken);
    if (!parsed) return;
    const hash = this.hashToken(refreshToken);
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: parsed.selector },
    });
    if (!token || !this.hashMatches(token.tokenHash, hash)) return;
    await this.revokeFamily(token.userId, token.familyId);
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
            status: true,
            emailVerifiedAt: true,
          },
        },
      },
    });

    if (
      !record ||
      !this.hashMatches(record.tokenHash, tokenHash) ||
      record.usedAt !== null ||
      record.expiresAt <= now ||
      !this.isUserAccountActive(record.user)
    ) {
      throw new BadRequestException(INVALID_VERIFICATION_TOKEN_MESSAGE);
    }

    const verifiedAt = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.emailVerificationToken.updateMany({
          where: {
            id: record.id,
            tokenHash: record.tokenHash,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(INVALID_VERIFICATION_TOKEN_MESSAGE);
        }

        const effectiveVerifiedAt = record.user.emailVerifiedAt ?? now;
        await tx.user.update({
          where: { id: record.userId },
          data: { emailVerifiedAt: effectiveVerifiedAt },
        });
        await tx.emailVerificationToken.updateMany({
          where: {
            userId: record.userId,
            usedAt: null,
          },
          data: { usedAt: now },
        });

        return effectiveVerifiedAt;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    return {
      verified: true,
      emailVerifiedAt: verifiedAt,
    };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        status: true,
        emailVerifiedAt: true,
      },
    });

    if (user && this.isUserAccountActive(user) && !user.emailVerifiedAt) {
      await this.issueEmailVerification(user.id, user.email, user.name);
    } else {
      // Constant-work token generation to reduce timing differences.
      this.newOpaqueToken();
    }

    return { message: RESEND_VERIFICATION_GENERIC_MESSAGE };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        status: true,
      },
    });

    const generated = this.newOpaqueToken();

    if (user && this.isUserAccountActive(user)) {
      const now = new Date();
      const ttlMinutes =
        this.mailing?.getPasswordResetTtlMinutes() ??
        DEFAULT_PASSWORD_RESET_TTL_MINUTES;
      const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

      await this.prisma.$transaction(
        async (tx) => {
          await tx.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: now },
          });
          await tx.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash: generated.hash,
              expiresAt,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );

      if (this.mailing) {
        const resetUrl = this.mailing.buildFrontendUrl('/reset-password', {
          token: generated.value,
        });
        await this.mailing
          .sendPasswordReset(user.email, {
            recipientName: user.name,
            resetUrl,
            expiresInMinutes: ttlMinutes,
          })
          .catch(() => {
            this.logger.warn(
              `Password reset email dispatch failed for user ${user.id}.`,
            );
          });
      }
    }

    return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    const tokenHash = this.hashToken(dto.token);
    const now = new Date();
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
            status: true,
          },
        },
      },
    });

    if (
      !record ||
      !this.hashMatches(record.tokenHash, tokenHash) ||
      record.usedAt !== null ||
      record.expiresAt <= now ||
      !this.isUserAccountActive(record.user)
    ) {
      throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({
          where: {
            id: record.id,
            tokenHash: record.tokenHash,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
        }

        await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash },
        });

        await tx.passwordResetToken.updateMany({
          where: { userId: record.userId, usedAt: null },
          data: { usedAt: now },
        });

        await tx.refreshToken.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: now },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    return {
      message:
        'Password has been reset successfully. Please log in with your new password.',
    };
  }

  private async issueEmailVerification(
    userId: string,
    email: string,
    name: string,
  ): Promise<void> {
    if (!this.prisma.emailVerificationToken) {
      return;
    }

    const now = new Date();
    const ttlMinutes =
      this.mailing?.getEmailVerificationTtlMinutes() ??
      DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES;
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    const generated = this.newOpaqueToken();

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.emailVerificationToken.updateMany({
            where: { userId, usedAt: null },
            data: { usedAt: now },
          });
          await tx.emailVerificationToken.create({
            data: {
              userId,
              tokenHash: generated.hash,
              expiresAt,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );

      if (this.mailing) {
        const verificationUrl = this.mailing.buildFrontendUrl('/verify-email', {
          token: generated.value,
        });
        await this.mailing.sendEmailVerification(email, {
          recipientName: name,
          verificationUrl,
          expiresInMinutes: ttlMinutes,
        });
      }
    } catch {
      this.logger.warn(
        `Email verification issuance failed for user ${userId}; account remains active.`,
      );
    }
  }

  private newOpaqueToken() {
    const value = randomBytes(32).toString('base64url');
    return { value, hash: this.hashToken(value) };
  }

  private async createSession(userId: string, email: string, role: string) {
    const refreshToken = this.newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        id: refreshToken.selector,
        userId,
        familyId: randomUUID(),
        tokenHash: refreshToken.hash,
        expiresAt: this.refreshExpiry(new Date()),
      },
    });
    return {
      accessToken: await this.jwtService.signAsync({
        sub: userId,
        email,
        role,
      }),
      refreshToken: refreshToken.value,
    };
  }

  private newRefreshToken() {
    const selector = randomUUID();
    const value = `${selector}.${randomBytes(32).toString('base64url')}`;
    return { selector, value, hash: this.hashToken(value) };
  }

  private hashToken(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private hashMatches(stored: string, actual: string) {
    const left = Buffer.from(stored, 'hex');
    const right = Buffer.from(actual, 'hex');
    return (
      left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
    );
  }

  private parseRefreshToken(value: string) {
    const match =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(
        value,
      );
    return match ? { selector: match[1] } : null;
  }

  private refreshExpiry(now: Date) {
    return new Date(
      now.getTime() +
        this.config.getOrThrow<number>('JWT_REFRESH_TOKEN_TTL_SECONDS') * 1000,
    );
  }

  private async revokeFamily(userId: string, familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private safeUser(user: any) {
    const { passwordHash: _passwordHash, role, ...rest } = user;
    return {
      ...rest,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      isEmailVerified: Boolean(user.emailVerifiedAt),
      role: role.name,
    };
  }
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        roleId: true,
        isActive: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        role: {
          select: {
            name: true,
            permissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });

    if (!user || !this.isUserAccountActive(user)) {
      throw new UnauthorizedException(
        user ? 'Account is Disabled' : 'User not found',
      );
    }

    const { role, ...safeUser } = user;
    return {
      user: {
        ...safeUser,
        emailVerifiedAt: user.emailVerifiedAt ?? null,
        isEmailVerified: Boolean(user.emailVerifiedAt),
        role: role.name,
      },
      permissions: this.permissionCodes(role),
    };
  }

  private isUserAccountActive(user: {
    isActive: boolean;
    status?: UserStatus;
  }): boolean {
    return (
      user.isActive &&
      (user.status === undefined || user.status === UserStatus.ACTIVE)
    );
  }

  private permissionCodes(role: {
    permissions?: Array<{ permission: { code: string } }>;
  }): string[] {
    return (role.permissions ?? [])
      .map(({ permission }) => permission.code)
      .sort((a, b) => a.localeCompare(b));
  }
}

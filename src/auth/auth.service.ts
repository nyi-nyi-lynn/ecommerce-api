import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
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
        role: { select: { name: true } },
        createdAt: true,
      },
    });
    const tokens = await this.createSession(
      user.id,
      user.email,
      user.role.name,
    );
    return { user: { ...user, role: user.role.name }, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { role: { select: { name: true } } },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Credential Error!!');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is Disabled');
    }

    const tokens = await this.createSession(
      user.id,
      user.email,
      user.role.name,
    );
    const { passwordHash: _, role, ...safeUser } = user;
    return {
      user: { ...safeUser, role: role.name },
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
    if (record.expiresAt <= new Date() || !record.user.isActive) {
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

  private async createSession(userId: number, email: string, role: string) {
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

  private async revokeFamily(userId: number, familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private safeUser(user: any) {
    const { passwordHash: _passwordHash, role, ...rest } = user;
    return { ...rest, role: role.name };
  }
  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: { select: { name: true } },
        isActive: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { ...user, role: user.role.name };
  }
}

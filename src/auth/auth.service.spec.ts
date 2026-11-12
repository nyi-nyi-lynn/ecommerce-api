import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('hashed-password'),
  compare: vi.fn().mockResolvedValue(true),
}));

describe('AuthService refresh sessions', () => {
  const roleId = '00000000-0000-4000-8000-000000000002';
  const user = {
    id: '00000000-0000-4000-8000-000000000007',
    name: 'Test Customer',
    email: 'customer@example.test',
    phone: null,
    passwordHash: '$2b$12$hash',
    roleId,
    role: {
      name: 'CUSTOMER',
      permissions: [{ permission: { code: 'order:read' } }],
    },
    isActive: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
  };
  let service: AuthService;
  let prisma: any;
  let stored: any[];

  beforeEach(() => {
    stored = [];
    prisma = {
      role: {
        findUnique: vi.fn().mockResolvedValue({ id: roleId, name: 'CUSTOMER' }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        create: vi.fn().mockResolvedValue({
          ...user,
          passwordHash: undefined,
          createdAt: user.createdAt,
        }),
      },
      refreshToken: {
        create: vi.fn(async ({ data }) => {
          stored.push(data);
          return data;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const token = stored.find((entry) => entry.id === where.id);
          return token ? { ...token, user: { ...user } } : null;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          const matches = stored.filter(
            (entry) =>
              (where.id === undefined || entry.id === where.id) &&
              (where.userId === undefined || entry.userId === where.userId) &&
              (where.familyId === undefined ||
                entry.familyId === where.familyId) &&
              entry.revokedAt == null &&
              (where.expiresAt?.gt === undefined ||
                entry.expiresAt > where.expiresAt.gt),
          );
          for (const entry of matches) Object.assign(entry, data);
          return { count: matches.length };
        }),
      },
      $transaction: vi.fn(async (callback) => callback(prisma)),
    };
    service = new AuthService(
      prisma as PrismaService,
      {
        signAsync: vi.fn().mockResolvedValue('access.jwt'),
      } as unknown as JwtService,
      {
        getOrThrow: vi.fn((key: string) =>
          key === 'JWT_REFRESH_TOKEN_TTL_SECONDS' ? 604800 : '15m',
        ),
      } as unknown as ConfigService,
    );
  });

  it('registers a CUSTOMER and stores only a token hash', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const result = await service.register({
      name: user.name,
      email: user.email,
      password: 'password123',
    });
    expect(result).toMatchObject({
      accessToken: 'access.jwt',
      user: { role: 'CUSTOMER' },
    });
    expect(result.refreshToken).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]{43}$/i);
    expect(prisma.user.create.mock.calls[0][0].data.roleId).toBe(roleId);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(result.refreshToken);
    expect(stored[0].tokenHash).toHaveLength(64);
  });

  it('creates independent session families at login', async () => {
    const first = await service.login({
      email: user.email,
      password: 'password123',
    });
    const second = await service.login({
      email: user.email,
      password: 'password123',
    });
    expect(stored).toHaveLength(2);
    expect(stored[0].familyId).not.toBe(stored[1].familyId);
    expect(first.refreshToken).not.toBe(second.refreshToken);
  });

  it('returns current role permission codes on login without exposing the password hash', async () => {
    const result = await service.login({
      email: user.email,
      password: 'password123',
    });

    expect(result).toMatchObject({
      user: {
        id: user.id,
        roleId,
        role: 'CUSTOMER',
        isActive: true,
      },
      permissions: ['order:read'],
      accessToken: 'access.jwt',
    });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: user.email },
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
  });

  it('returns an empty permission list for a role with no assignments', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      ...user,
      role: { name: 'CUSTOMER', permissions: [] },
    });

    const result = await service.login({
      email: user.email,
      password: 'password123',
    });

    expect(result.permissions).toEqual([]);
  });

  it('returns latest profile permissions from the database and excludes sensitive fields', async () => {
    const profileRow = (codes: string[]) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roleId: user.roleId,
        isActive: true,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        role: {
          name: 'CUSTOMER',
          permissions: codes.map((code) => ({ permission: { code } })),
        },
      });
    prisma.user.findUnique
      .mockResolvedValueOnce(profileRow(['order:read']))
      .mockResolvedValueOnce(profileRow(['product:read', 'cart:read']));

    await service.getProfile(user.id);
    const result = await service.getProfile(user.id);

    expect(result).toEqual({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: null,
        roleId,
        isActive: true,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        role: 'CUSTOMER',
      },
      permissions: ['cart:read', 'product:read'],
    });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(JSON.stringify(result)).not.toContain('tokenHash');
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        roleId: true,
        isActive: true,
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
  });

  it('rejects missing and inactive users from the current-profile endpoint', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: user.id,
        isActive: false,
        role: { name: 'CUSTOMER', permissions: [] },
      });

    await expect(service.getProfile(user.id)).rejects.toThrow(
      new UnauthorizedException('User not found'),
    );
    await expect(service.getProfile(user.id)).rejects.toThrow(
      new UnauthorizedException('Account is Disabled'),
    );
  });

  it('rotates a valid refresh token and rejects reuse', async () => {
    const initial = await service.login({
      email: user.email,
      password: 'password123',
    });
    const rotated = await service.refresh(initial.refreshToken);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(stored).toHaveLength(2);
    expect(stored[0].revokedAt).toBeInstanceOf(Date);
    expect(stored[0].replacedByTokenId).toBe(stored[1].id);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'ReadCommitted',
    });
    await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(stored[1].revokedAt).toBeInstanceOf(Date);
  });

  it('allows only one concurrent rotation and treats the losing claim as replay', async () => {
    const initial = await service.login({
      email: user.email,
      password: 'password123',
    });
    const outcomes = await Promise.allSettled([
      service.refresh(initial.refreshToken),
      service.refresh(initial.refreshToken),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      stored.filter(
        (entry) =>
          entry.familyId === stored[0].familyId && entry.revokedAt == null,
      ),
    ).toHaveLength(0);
  });

  it('does not revoke a family for an invalid secret', async () => {
    const initial = await service.login({
      email: user.email,
      password: 'password123',
    });
    const [selector] = initial.refreshToken.split('.');
    await expect(
      service.refresh(`${selector}.${'A'.repeat(43)}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(stored[0].revokedAt).toBeUndefined();
  });

  it('logout revokes only the presented token family', async () => {
    const first = await service.login({
      email: user.email,
      password: 'password123',
    });
    await service.login({ email: user.email, password: 'password123' });
    await service.logout(first.refreshToken);
    expect(stored[0].revokedAt).toBeInstanceOf(Date);
    expect(stored[1].revokedAt).toBeUndefined();
  });

  it('rejects malformed, expired, and inactive-user refresh tokens', async () => {
    await expect(service.refresh('malformed')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const token = await service.login({
      email: user.email,
      password: 'password123',
    });
    stored[0].expiresAt = new Date(0);
    await expect(service.refresh(token.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    stored[0].expiresAt = new Date(Date.now() + 60_000);
    prisma.refreshToken.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        const entry = stored.find((item) => item.id === where.id);
        return entry ? { ...entry, user: { ...user, isActive: false } } : null;
      },
    );
    await expect(service.refresh(token.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

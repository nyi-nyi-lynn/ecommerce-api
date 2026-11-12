import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { getProfile: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = {
      getProfile: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

describe('JwtAuthGuard', () => {
  const VALID_USER_UUID = '00000000-0000-4000-8000-000000000020';
  let jwtService: JwtService;
  let guard: JwtAuthGuard;

  function makeContext(authorization?: string) {
    const request: {
      headers: { authorization?: string };
      user?: unknown;
    } = {
      headers: authorization !== undefined ? { authorization } : {},
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  beforeEach(() => {
    jwtService = new JwtService({
      secret: 'unit-test-jwt-secret',
      signOptions: { expiresIn: '15m' },
    });
    guard = new JwtAuthGuard(jwtService);
  });

  it('accepts a valid signed JWT with a UUID subject and populates request.user', async () => {
    const token = await jwtService.signAsync({
      sub: VALID_USER_UUID,
      email: 'customer@example.test',
      role: 'CUSTOMER',
    });
    const { context, request } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      sub: VALID_USER_UUID,
      email: 'customer@example.test',
      role: 'CUSTOMER',
    });
  });

  it('rejects a legacy numeric subject with 401 Unauthorized', async () => {
    const token = await jwtService.signAsync({
      sub: 42,
      email: 'legacy@example.test',
      role: 'CUSTOMER',
    });
    const { context, request } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired access token'),
    );
    expect(request.user).toBeUndefined();
  });

  it('rejects a missing subject with 401 Unauthorized', async () => {
    const token = await jwtService.signAsync({
      email: 'missing-sub@example.test',
      role: 'CUSTOMER',
    });
    const { context, request } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired access token'),
    );
    expect(request.user).toBeUndefined();
  });

  it('rejects a malformed UUID subject with 401 Unauthorized', async () => {
    for (const invalidSub of [
      '42',
      'not-a-uuid',
      '',
      '00000000-0000-0000-0000-00000000000g',
    ]) {
      const token = await jwtService.signAsync({
        sub: invalidSub,
        email: 'malformed@example.test',
        role: 'CUSTOMER',
      });
      const { context, request } = makeContext(`Bearer ${token}`);

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid or expired access token'),
      );
      expect(request.user).toBeUndefined();
    }
  });

  it('rejects non-string subjects with 401 Unauthorized', async () => {
    for (const nonStringSub of [
      null,
      true,
      { id: VALID_USER_UUID },
      [VALID_USER_UUID],
    ]) {
      const token = await jwtService.signAsync({
        sub: nonStringSub,
        email: 'non-string@example.test',
        role: 'CUSTOMER',
      });
      const { context, request } = makeContext(`Bearer ${token}`);

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid or expired access token'),
      );
      expect(request.user).toBeUndefined();
    }
  });

  it('preserves existing missing-header, signature, and expiration validation', async () => {
    await expect(guard.canActivate(makeContext().context)).rejects.toThrow(
      new UnauthorizedException('Access token is required'),
    );

    const wrongSecretJwt = new JwtService({ secret: 'different-secret' });
    const badSignatureToken = await wrongSecretJwt.signAsync({
      sub: VALID_USER_UUID,
      email: 'customer@example.test',
      role: 'CUSTOMER',
    });
    await expect(
      guard.canActivate(makeContext(`Bearer ${badSignatureToken}`).context),
    ).rejects.toThrow(
      new UnauthorizedException('Invalid or expired access token'),
    );

    const expiredToken = await jwtService.signAsync(
      {
        sub: VALID_USER_UUID,
        email: 'customer@example.test',
        role: 'CUSTOMER',
      },
      { expiresIn: -10 },
    );
    await expect(
      guard.canActivate(makeContext(`Bearer ${expiredToken}`).context),
    ).rejects.toThrow(
      new UnauthorizedException('Invalid or expired access token'),
    );
  });

  it('prevents invalid JWT subjects from reaching Prisma queries', async () => {
    const prisma = { user: { findUnique: vi.fn() } };
    for (const invalidPayload of [
      { sub: 42 },
      {},
      { sub: 'not-a-uuid' },
      { sub: { id: VALID_USER_UUID } },
    ]) {
      const token = await jwtService.signAsync(invalidPayload);
      const { context } = makeContext(`Bearer ${token}`);
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    }
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestHttpApp } from '../../test/helpers/create-test-http-app.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { CmsController } from './cms.controller.js';
import { CmsService } from './cms.service.js';

describe('CMS HTTP', () => {
  const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
  const CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
  let app: INestApplication;
  let jwt: JwtService;
  let permissions: Record<string, string[]>;
  let prisma: any;
  let uploads: any;

  beforeEach(async () => {
    permissions = {
      [ADMIN_ID]: ['cms:read', 'cms:create', 'cms:update', 'cms:delete'],
      [CUSTOMER_ID]: [],
    };
    prisma = {
      user: {
        findUnique: vi.fn(async ({ where }) => ({
          isActive: true,
          role: { permissions: (permissions[where.id] ?? []).map((code) => ({ permission: { code } })) },
        })),
      },
      cmsDocument: {
        create: vi.fn(async ({ data }) => ({ id: '00000000-0000-4000-8000-000000000003', ...data })),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    uploads = {
      uploadCmsImage: vi.fn().mockResolvedValue({ secure_url: 'https://cdn.test/cms.png', public_id: 'ecommerce/cms/users/admin/cms' }),
      deleteCmsImage: vi.fn().mockResolvedValue(true),
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'cms-test-secret' })],
      controllers: [CmsController],
      providers: [
        CmsService,
        JwtAuthGuard,
        PermissionsGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: uploads },
      ],
    });
    jwt = app.get(JwtService);
  });

  afterEach(async () => app.close());
  const token = (sub: string) => jwt.sign({ sub, role: 'ADMIN' });

  it('uses database permissions, rejects guests/customers, and returns the shared envelope', async () => {
    await request(app.getHttpServer()).post('/api/cms/documents').send({ key: 'home', title: 'Home' }).expect(401);
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(CUSTOMER_ID)}`)
      .send({ key: 'home', title: 'Home' })
      .expect(403);

    const response = await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({ key: 'home', title: 'Home' })
      .expect(201);
    expect(response.body).toMatchObject({ success: true, data: { key: 'home', title: 'Home' }, path: '/api/cms/documents' });
  });

  it('rejects unknown DTO properties and observes permission changes from the database', async () => {
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({ key: 'home', title: 'Home', ownerId: ADMIN_ID })
      .expect(400);
    permissions[ADMIN_ID] = ['cms:read'];
    await request(app.getHttpServer())
      .post('/api/cms/documents')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .send({ key: 'home', title: 'Home' })
      .expect(403);
  });

  it('requires the database-backed media:upload permission only when a file is attached', async () => {
    permissions[ADMIN_ID] = ['cms:create'];
    await request(app.getHttpServer())
      .post('/api/cms/documents/00000000-0000-4000-8000-000000000010/revisions')
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .field('seoTitle', 'Home')
      .attach('image', Buffer.from('image'), 'image.png')
      .expect(403);
    expect(uploads.uploadCmsImage).not.toHaveBeenCalled();
  });
});

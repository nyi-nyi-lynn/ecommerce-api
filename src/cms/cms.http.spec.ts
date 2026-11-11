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
import { CmsPublishingController } from './cms-publishing.controller.js';
import { CmsPublicController } from './cms-public.controller.js';

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
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      cmsRevision: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback) => callback({
        $queryRaw: vi.fn().mockResolvedValue([{ id: '00000000-0000-4000-8000-000000000003' }]),
        cmsDocument: { findUnique: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000003', key: 'home', title: 'Home' }) },
        cmsRevision: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue({ status: 'DRAFT', sections: [] }),
          update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data, sections: [] })),
        },
      })),
    };
    uploads = {
      uploadCmsImage: vi.fn().mockResolvedValue({ secure_url: 'https://cdn.test/cms.png', public_id: 'ecommerce/cms/users/admin/cms' }),
      deleteCmsImage: vi.fn().mockResolvedValue(true),
    };
    app = await createTestHttpApp({
      imports: [JwtModule.register({ secret: 'cms-test-secret' })],
      controllers: [CmsController, CmsPublishingController, CmsPublicController],
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

  it('serves published pages without authentication and returns only public fields', async () => {
    prisma.cmsDocument.findFirst.mockResolvedValue({
      key: 'home',
      title: 'Home',
      revisions: [{
        seoTitle: 'Home SEO',
        seoDescription: 'Welcome',
        ogImageUrl: 'https://cdn.test/og.png',
        sections: [{
          key: 'hero', type: 'hero', position: 0, content: { headline: 'Hello' }, imageUrl: null,
          items: [{ position: 0, title: 'Shop', body: null, url: '/products', label: 'Browse', category: null }],
        }],
      }],
    });
    const response = await request(app.getHttpServer()).get('/api/cms/pages/home').expect(200);
    expect(response.body.data).toMatchObject({ key: 'home', title: 'Home', seoTitle: 'Home SEO' });
    expect(response.body.data.sections[0].content).toEqual({ headline: 'Hello' });
    expect(response.body.data).not.toHaveProperty('createdById');
    expect(response.body.data).not.toHaveProperty('revisionId');
  });

  it('protects draft preview and publishing with their database permissions', async () => {
    const documentId = '00000000-0000-4000-8000-000000000003';
    await request(app.getHttpServer())
      .get(`/api/admin/cms/documents/${documentId}/preview`)
      .set('Authorization', `Bearer ${token(CUSTOMER_ID)}`)
      .expect(403);

    permissions[ADMIN_ID] = ['cms:read'];
    const preview = await request(app.getHttpServer())
      .get(`/api/admin/cms/documents/${documentId}/preview`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .expect(404);
    expect(preview.body).toMatchObject({ success: false, statusCode: 404 });

    await request(app.getHttpServer())
      .post(`/api/admin/cms/documents/${documentId}/publish`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .expect(403);
  });

  it('allows a cms:read user to preview only the current DRAFT without changing status', async () => {
    const documentId = '00000000-0000-4000-8000-000000000003';
    prisma.cmsDocument.findUnique.mockResolvedValue({
      id: documentId,
      key: 'home',
      title: 'Home',
      revisions: [{
        id: '00000000-0000-4000-8000-000000000004',
        revisionNumber: 2,
        status: 'DRAFT',
        seoTitle: 'Draft SEO',
        sections: [],
      }],
    });
    const response = await request(app.getHttpServer())
      .get(`/api/admin/cms/documents/${documentId}/preview`)
      .set('Authorization', `Bearer ${token(ADMIN_ID)}`)
      .expect(200);
    expect(response.body.data.revision.status).toBe('DRAFT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

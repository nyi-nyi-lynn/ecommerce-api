import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CmsDocumentStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { CmsService } from './cms.service.js';

describe('CmsService', () => {
  const DOC_ID = '00000000-0000-4000-8000-000000000001';
  const SECTION_ID = '00000000-0000-4000-8000-000000000002';
  const ITEM_ID = '00000000-0000-4000-8000-000000000003';
  const USER_ID = '00000000-0000-4000-8000-000000000004';
  let prisma: any;
  let tx: any;
  let uploads: any;
  let service: CmsService;
  let document: any;

  beforeEach(() => {
    document = {
      id: DOC_ID,
      key: 'about-us',
      title: 'About',
      status: CmsDocumentStatus.DRAFT,
      publishedAt: null,
      ogImagePublicId: null,
    };
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: DOC_ID }]),
      cmsDocument: {
        findUnique: vi.fn(async () => document),
        delete: vi.fn(async () => document),
        update: vi.fn(async ({ data }) => Object.assign(document, data)),
      },
      cmsSection: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ documentId: DOC_ID, imagePublicId: null }),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(async ({ data }) => ({ id: SECTION_ID, ...data })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi.fn().mockResolvedValue({ id: SECTION_ID }),
      },
      cmsSectionItem: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi
          .fn()
          .mockResolvedValue({ section: { documentId: DOC_ID } }),
        create: vi.fn(async ({ data }) => ({ id: ITEM_ID, ...data })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi.fn().mockResolvedValue({ id: ITEM_ID }),
      },
      category: { findUnique: vi.fn().mockResolvedValue({ id: DOC_ID }) },
    };
    prisma = {
      cmsDocument: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(async () => document),
        findUniqueOrThrow: vi.fn(async () => document),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async ({ data }) => ({ id: DOC_ID, ...data })),
        updateMany: vi.fn(async ({ where, data }) => {
          if (document.id !== where.id || document.status !== where.status)
            return { count: 0 };
          Object.assign(document, data);
          return { count: 1 };
        }),
        delete: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      cmsSection: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi
          .fn()
          .mockResolvedValue({ documentId: DOC_ID, imagePublicId: null }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      cmsSectionItem: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi
          .fn()
          .mockResolvedValue({ section: { documentId: DOC_ID } }),
      },
      category: { findUnique: vi.fn().mockResolvedValue({ id: DOC_ID }) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    uploads = {
      uploadCmsImage: vi
        .fn()
        .mockResolvedValue({
          secure_url: 'https://cdn.test/cms.png',
          public_id: 'ecommerce/cms/users/u/cms',
        }),
      deleteCmsImage: vi.fn().mockResolvedValue(true),
    };
    service = new CmsService(
      prisma as PrismaService,
      uploads as UploadsService,
    );
  });

  it('lists documents with bounded pagination and matching status/search filters', async () => {
    await service.listDocuments({
      page: 2,
      limit: 10,
      status: CmsDocumentStatus.PUBLISHED,
      search: 'about',
    });
    expect(prisma.cmsDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CmsDocumentStatus.PUBLISHED,
          OR: expect.any(Array),
        }),
        skip: 10,
        take: 10,
        orderBy: [{ key: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('creates a document with direct metadata and creator identity', async () => {
    await service.createDocument(
      { key: 'about-us', title: 'About', seoTitle: 'About us' },
      undefined,
      USER_ID,
    );
    expect(prisma.cmsDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'about-us',
        title: 'About',
        seoTitle: 'About us',
        createdById: USER_ID,
      }),
    });
  });

  it('returns ordered document details and reports a missing document', async () => {
    prisma.cmsDocument.findUnique.mockResolvedValueOnce({
      id: DOC_ID,
      sections: [],
    });
    expect(await service.getDocument(DOC_ID)).toMatchObject({
      id: DOC_ID,
      sections: [],
    });
    prisma.cmsDocument.findUnique.mockResolvedValueOnce(null);
    await expect(service.getDocument(DOC_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates published document metadata without changing its publication status', async () => {
    document.status = CmsDocumentStatus.PUBLISHED;
    await service.updateDocument(
      DOC_ID,
      { title: 'New title', seoTitle: null },
      undefined,
      USER_ID,
    );
    expect(tx.cmsDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: 'New title', seoTitle: null } }),
    );
    expect(document.status).toBe(CmsDocumentStatus.PUBLISHED);
  });

  it('publishes and unpublishes idempotently', async () => {
    const published = await service.publishDocument(DOC_ID, USER_ID);
    expect(published.status).toBe(CmsDocumentStatus.PUBLISHED);
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(published.publishedById).toBe(USER_ID);
    expect(await service.publishDocument(DOC_ID, USER_ID)).toBe(published);
    const draft = await service.unpublishDocument(DOC_ID);
    expect(draft.status).toBe(CmsDocumentStatus.DRAFT);
    expect(draft.publishedAt).toBeNull();
    expect(await service.unpublishDocument(DOC_ID)).toBe(draft);
  });

  it('returns not found when publishing a missing document', async () => {
    document = null;
    prisma.cmsDocument.updateMany.mockResolvedValue({ count: 0 });
    prisma.cmsDocument.findUnique.mockResolvedValue(null);
    await expect(
      service.publishDocument(DOC_ID, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes a document and cascaded content, then only cleans unreferenced images', async () => {
    tx.cmsDocument.findUnique.mockResolvedValue({
      ogImagePublicId: 'og',
      sections: [{ imagePublicId: 'section' }],
    });
    await service.deleteDocument(DOC_ID);
    expect(tx.cmsDocument.delete).toHaveBeenCalledWith({
      where: { id: DOC_ID },
    });
    expect(prisma.cmsDocument.findFirst).toHaveBeenCalledWith({
      where: { ogImagePublicId: 'og' },
      select: { id: true },
    });
    expect(uploads.deleteCmsImage).toHaveBeenCalledTimes(2);
  });

  it('public list and detail filter on the document PUBLISHED status', async () => {
    await service.listPublishedPages({ page: 1, limit: 20 });
    expect(prisma.cmsDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: CmsDocumentStatus.PUBLISHED },
      }),
    );
    prisma.cmsDocument.findUnique.mockResolvedValueOnce(null);
    await expect(service.getPublishedPage('about-us')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.cmsDocument.findUnique.mockResolvedValueOnce({
      key: 'about-us',
      title: 'About',
      seoTitle: null,
      seoDescription: null,
      ogImageUrl: null,
      sections: [],
    });
    await service.getPublishedPage('about-us');
    expect(prisma.cmsDocument.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { key: 'about-us', status: CmsDocumentStatus.PUBLISHED },
      }),
    );
  });

  it('public detail selects only visible sections and orders sections and items', async () => {
    prisma.cmsDocument.findUnique.mockResolvedValueOnce({
      key: 'about-us',
      title: 'About',
      seoTitle: null,
      seoDescription: null,
      ogImageUrl: null,
      sections: [
        {
          key: 'hero',
          type: 'hero',
          position: 0,
          content: {},
          imageUrl: null,
          items: [],
        },
      ],
    });
    await service.getPublishedPage('about-us');
    expect(prisma.cmsDocument.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          sections: expect.objectContaining({
            where: { isVisible: true },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: expect.objectContaining({
              items: expect.objectContaining({
                orderBy: [{ position: 'asc' }, { id: 'asc' }],
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('creates sections directly under documents and rejects invalid JSON', async () => {
    await service.createSection(
      DOC_ID,
      {
        key: 'hero',
        type: 'hero',
        position: 0,
        content: { headline: 'Welcome' },
      },
      undefined,
      USER_ID,
    );
    expect(tx.cmsSection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentId: DOC_ID,
        content: { headline: 'Welcome' },
      }),
    });
    await expect(
      service.createSection(
        DOC_ID,
        { key: 'bad', type: 'text', position: 1, content: [] as any },
        undefined,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reorders sections transactionally using temporary positions', async () => {
    const otherId = '00000000-0000-4000-8000-000000000009';
    tx.cmsSection.findMany
      .mockResolvedValueOnce([
        { id: SECTION_ID, position: 0 },
        { id: otherId, position: 1 },
      ])
      .mockResolvedValueOnce([]);
    await service.reorderSections(DOC_ID, [otherId, SECTION_ID]);
    expect(tx.cmsSection.update).toHaveBeenNthCalledWith(1, {
      where: { id: otherId },
      data: { position: -1 },
    });
    expect(tx.cmsSection.update).toHaveBeenNthCalledWith(3, {
      where: { id: otherId },
      data: { position: 0 },
    });
  });

  it('deletes a section and its items through the database cascade', async () => {
    await service.deleteSection(SECTION_ID);
    expect(tx.cmsSection.delete).toHaveBeenCalledWith({
      where: { id: SECTION_ID },
    });
  });

  it('creates items after checking the optional Category relation and preserves null updates', async () => {
    await service.createItem(SECTION_ID, { position: 0, categoryId: DOC_ID });
    expect(tx.cmsSectionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sectionId: SECTION_ID,
        categoryId: DOC_ID,
      }),
    });
    prisma.cmsSectionItem.findUnique.mockResolvedValue({
      section: { documentId: DOC_ID },
    });
    await service.updateItem(ITEM_ID, { title: null, categoryId: null });
    expect(tx.cmsSectionItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { title: null, categoryId: null },
    });
  });

  it('rechecks the section under the document lock before creating an item', async () => {
    prisma.cmsSection.findUnique.mockResolvedValueOnce({ documentId: DOC_ID });
    tx.cmsSection.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.createItem(SECTION_ID, { position: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.cmsSectionItem.create).not.toHaveBeenCalled();
  });

  it('reorders section items using temporary positions and deletes an item transactionally', async () => {
    tx.cmsSectionItem.findMany
      .mockResolvedValueOnce([{ id: ITEM_ID, position: 0 }])
      .mockResolvedValueOnce([]);
    await service.reorderItems(SECTION_ID, [ITEM_ID]);
    expect(tx.cmsSectionItem.update).toHaveBeenNthCalledWith(1, {
      where: { id: ITEM_ID },
      data: { position: -1 },
    });
    await service.deleteItem(ITEM_ID);
    expect(tx.cmsSectionItem.delete).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
    });
  });

  it('returns not found if the section disappears before item reorder acquires its lock', async () => {
    prisma.cmsSection.findUnique.mockResolvedValueOnce({ documentId: DOC_ID });
    tx.cmsSection.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.reorderItems(SECTION_ID, [ITEM_ID]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.cmsSectionItem.findMany).not.toHaveBeenCalled();
  });

  it('cleans newly uploaded image after a failed section write', async () => {
    tx.cmsSection.create.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      service.createSection(
        DOC_ID,
        { key: 'hero', type: 'hero', position: 0, content: {} },
        { buffer: Buffer.from('x') } as Express.Multer.File,
        USER_ID,
      ),
    ).rejects.toThrow('write failed');
    expect(uploads.deleteCmsImage).toHaveBeenCalledWith(
      'ecommerce/cms/users/u/cms',
    );
  });

  it('retains replaced images still referenced by another CMS record', async () => {
    prisma.cmsSection.findUnique.mockResolvedValue({
      documentId: DOC_ID,
      imagePublicId: 'shared-image',
    });
    tx.cmsSection.findUnique.mockResolvedValue({
      imagePublicId: 'shared-image',
    });
    prisma.cmsSection.findFirst.mockResolvedValue({ id: 'another-section' });
    await service.updateSection(
      SECTION_ID,
      {},
      { buffer: Buffer.from('x') } as Express.Multer.File,
      USER_ID,
    );
    expect(uploads.deleteCmsImage).not.toHaveBeenCalled();
  });

  it('rejects reorder requests that omit an existing section', async () => {
    tx.cmsSection.findMany.mockResolvedValue([{ id: SECTION_ID, position: 0 }]);
    await expect(service.reorderSections(DOC_ID, [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

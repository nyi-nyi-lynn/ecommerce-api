import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CmsRevisionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { CmsService } from './cms.service.js';

describe('CmsService', () => {
  const DOC_ID = '00000000-0000-4000-8000-000000000001';
  const REV_ID = '00000000-0000-4000-8000-000000000002';
  const SECTION_ID = '00000000-0000-4000-8000-000000000003';
  const ITEM_ID = '00000000-0000-4000-8000-000000000004';
  const USER_ID = '00000000-0000-4000-8000-000000000005';

  let prisma: any;
  let tx: any;
  let uploads: any;
  let service: CmsService;

  beforeEach(() => {
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: DOC_ID }]),
      cmsDocument: {
        findUnique: vi.fn().mockResolvedValue({ id: DOC_ID }),
        count: vi.fn().mockResolvedValue(0),
        delete: vi.fn().mockResolvedValue({ id: DOC_ID }),
      },
      cmsRevision: {
        findFirst: vi.fn().mockResolvedValue({ revisionNumber: 4 }),
        findUnique: vi.fn().mockResolvedValue({ status: CmsRevisionStatus.DRAFT, ogImagePublicId: null }),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async ({ data }) => ({ id: REV_ID, ...data })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi.fn().mockResolvedValue({ id: REV_ID }),
      },
      cmsSection: {
        findUnique: vi.fn().mockResolvedValue({ revisionId: REV_ID, imagePublicId: null }),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(async ({ data }) => ({ id: SECTION_ID, ...data })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi.fn().mockResolvedValue({ id: SECTION_ID }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      cmsSectionItem: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ sectionId: SECTION_ID, section: { revisionId: REV_ID } }),
        create: vi.fn(async ({ data }) => ({ id: ITEM_ID, ...data })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: vi.fn().mockResolvedValue({ id: ITEM_ID }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      category: { findUnique: vi.fn().mockResolvedValue({ id: DOC_ID }) },
    };
    prisma = {
      cmsDocument: {
        findMany: vi.fn().mockResolvedValue([{ id: DOC_ID }]),
        findUnique: vi.fn().mockResolvedValue({ id: DOC_ID }),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(async ({ data }) => ({ id: DOC_ID, ...data })),
        update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      },
      cmsRevision: {
        findUnique: vi.fn().mockResolvedValue({ status: CmsRevisionStatus.DRAFT }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      cmsSection: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ revisionId: REV_ID, imagePublicId: null }),
      },
      cmsSectionItem: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    uploads = {
      uploadCmsImage: vi.fn().mockResolvedValue({ secure_url: 'https://cdn.example/cms.png', public_id: 'ecommerce/cms/users/u/cms' }),
      deleteCmsImage: vi.fn().mockResolvedValue(true),
    };
    service = new CmsService(prisma as PrismaService, uploads as UploadsService);
  });

  it('creates a document and maps duplicate keys to a conflict', async () => {
    await expect(service.createDocument({ key: 'home', title: 'Home' })).resolves.toMatchObject({ key: 'home' });
    prisma.cmsDocument.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.createDocument({ key: 'home', title: 'Home' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents deleting a document that has revision history', async () => {
    tx.cmsRevision.count.mockResolvedValue(1);
    await expect(service.deleteDocument(DOC_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.cmsDocument.delete).not.toHaveBeenCalled();
  });

  it('uses the same filter for paginated document rows and count', async () => {
    await service.listDocuments({ page: 2, limit: 10, search: 'about' });
    expect(prisma.cmsDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { key: { contains: 'about', mode: 'insensitive' } },
        { title: { contains: 'about', mode: 'insensitive' } },
      ] },
      skip: 10,
      take: 10,
    }));
    expect(prisma.cmsDocument.count).toHaveBeenCalledWith({ where: prisma.cmsDocument.findMany.mock.calls[0][0].where });
  });

  it('serializes revision numbering with a document row lock and creates a sequential DRAFT', async () => {
    const result = await service.createRevision(DOC_ID, {}, undefined, USER_ID);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.cmsRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      documentId: DOC_ID,
      revisionNumber: 5,
      status: CmsRevisionStatus.DRAFT,
      createdById: USER_ID,
    }) });
    expect(result.revisionNumber).toBe(5);
  });

  it('maps a partial unique draft conflict to a client-safe conflict', async () => {
    tx.cmsRevision.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.createRevision(DOC_ID, {}, undefined, USER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses edits and deletion of published revisions', async () => {
    prisma.cmsRevision.findUnique.mockResolvedValue({ status: CmsRevisionStatus.PUBLISHED });
    await expect(service.updateRevision(REV_ID, { seoTitle: 'Locked' }, undefined, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    tx.cmsRevision.findUnique.mockResolvedValue({ status: CmsRevisionStatus.PUBLISHED });
    await expect(service.deleteRevision(REV_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.cmsRevision.update).not.toHaveBeenCalled();
    expect(tx.cmsRevision.delete).not.toHaveBeenCalled();
  });

  it('refuses edits and deletion of archived revisions', async () => {
    prisma.cmsRevision.findUnique.mockResolvedValue({ status: CmsRevisionStatus.ARCHIVED });
    await expect(service.updateRevision(REV_ID, { seoTitle: 'Locked' }, undefined, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    tx.cmsRevision.findUnique.mockResolvedValue({ status: CmsRevisionStatus.ARCHIVED });
    await expect(service.deleteRevision(REV_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.cmsRevision.update).not.toHaveBeenCalled();
    expect(tx.cmsRevision.delete).not.toHaveBeenCalled();
  });

  it('publishes a draft and records publisher metadata when no previous publication exists', async () => {
    tx.cmsRevision.findFirst
      .mockResolvedValueOnce({ id: REV_ID })
      .mockResolvedValueOnce(null);
    tx.cmsRevision.findUnique
      .mockResolvedValueOnce({ status: CmsRevisionStatus.DRAFT })
      .mockResolvedValueOnce({ sections: [] });

    const result = await service.publishDocument(DOC_ID, USER_ID);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.cmsRevision.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: REV_ID },
      data: expect.objectContaining({
        status: CmsRevisionStatus.PUBLISHED,
        publishedById: USER_ID,
        publishedAt: expect.any(Date),
      }),
    }));
    expect(result.document).toMatchObject({ id: DOC_ID });
  });

  it('archives the previous publication before publishing its replacement', async () => {
    const previousId = '00000000-0000-4000-8000-000000000006';
    tx.cmsRevision.findFirst
      .mockResolvedValueOnce({ id: REV_ID })
      .mockResolvedValueOnce({ id: previousId });
    tx.cmsRevision.findUnique
      .mockResolvedValueOnce({ status: CmsRevisionStatus.DRAFT })
      .mockResolvedValueOnce({ sections: [] });

    await service.publishDocument(DOC_ID, USER_ID);

    expect(tx.cmsRevision.update).toHaveBeenNthCalledWith(1, {
      where: { id: previousId },
      data: { status: CmsRevisionStatus.ARCHIVED },
    });
    expect(tx.cmsRevision.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: REV_ID },
      data: expect.objectContaining({ status: CmsRevisionStatus.PUBLISHED }),
    }));
  });

  it('rejects publishing without a draft or with structurally invalid draft content', async () => {
    tx.cmsRevision.findFirst.mockResolvedValueOnce(null);
    await expect(service.publishDocument(DOC_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.cmsRevision.update).not.toHaveBeenCalled();

    tx.cmsRevision.findFirst.mockResolvedValueOnce({ id: REV_ID });
    tx.cmsRevision.findUnique
      .mockResolvedValueOnce({ status: CmsRevisionStatus.DRAFT })
      .mockResolvedValueOnce({ sections: [{ key: 'hero', type: 'hero', position: 0, content: [], items: [] }] });
    await expect(service.publishDocument(DOC_ID, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.cmsRevision.update).not.toHaveBeenCalled();
  });

  it('maps a publication uniqueness race to a client-safe conflict', async () => {
    tx.cmsRevision.findFirst
      .mockResolvedValueOnce({ id: REV_ID })
      .mockResolvedValueOnce(null);
    tx.cmsRevision.findUnique
      .mockResolvedValueOnce({ status: CmsRevisionStatus.DRAFT })
      .mockResolvedValueOnce({ sections: [] });
    tx.cmsRevision.update.mockRejectedValueOnce({ code: 'P2002' });

    await expect(service.publishDocument(DOC_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns only published revisions and excludes hidden sections from the public page', async () => {
    prisma.cmsDocument.findFirst.mockResolvedValue({
      key: 'home',
      title: 'Home',
      revisions: [{
        seoTitle: 'Home SEO',
        seoDescription: 'Description',
        ogImageUrl: 'https://cdn.test/og.png',
        sections: [{
          key: 'hero', type: 'hero', position: 0, content: { headline: 'Welcome' }, imageUrl: null,
          items: [{ position: 0, title: 'Shop', body: null, url: '/products', label: 'Shop', category: null }],
        }],
      }],
    });
    const page = await service.getPublishedPage('home');
    expect(page).toMatchObject({ key: 'home', title: 'Home', seoTitle: 'Home SEO' });
    expect(page.sections).toHaveLength(1);
    expect(page.sections[0].items[0]).toMatchObject({ title: 'Shop' });
    expect(page).not.toHaveProperty('revisionId');
    expect(prisma.cmsDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'home', revisions: { some: { status: CmsRevisionStatus.PUBLISHED } } },
      select: expect.objectContaining({
        revisions: expect.objectContaining({
          where: { status: CmsRevisionStatus.PUBLISHED },
          select: expect.objectContaining({
            sections: expect.objectContaining({ where: { isVisible: true } }),
          }),
        }),
      }),
    }));
  });

  it('does not return documents without a published revision and filters public listings consistently', async () => {
    await expect(service.getPublishedPage('home')).rejects.toBeInstanceOf(NotFoundException);
    prisma.cmsDocument.findMany.mockResolvedValueOnce([{ key: 'home', title: 'Home', revisions: [{ seoTitle: null, seoDescription: null, ogImageUrl: null }] }]);
    await service.listPublishedPages({ page: 2, limit: 10, search: 'home' });
    const where = prisma.cmsDocument.findMany.mock.calls.at(-1)?.[0].where;
    expect(where).toEqual(expect.objectContaining({ revisions: { some: { status: CmsRevisionStatus.PUBLISHED } } }));
    expect(prisma.cmsDocument.count).toHaveBeenLastCalledWith({ where });
  });

  it('creates structured section content only for a DRAFT revision', async () => {
    const content = { headline: 'Welcome', actions: [{ label: 'Shop', url: '/products' }] };
    await service.createSection(REV_ID, { key: 'hero', type: 'hero', position: 0, content }, undefined, USER_ID);
    expect(tx.cmsSection.create).toHaveBeenCalledWith({ data: expect.objectContaining({ content, revisionId: REV_ID }) });
    tx.cmsRevision.findUnique.mockResolvedValueOnce({ status: CmsRevisionStatus.PUBLISHED });
    await expect(service.createSection(REV_ID, { key: 'hero-2', type: 'hero', position: 1, content }, undefined, USER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reorders all sections in a transaction using temporary unique positions', async () => {
    tx.cmsSection.findMany
      .mockResolvedValueOnce([{ id: SECTION_ID, position: 1 }, { id: ITEM_ID, position: 0 }])
      .mockResolvedValueOnce([{ id: ITEM_ID, position: 0 }, { id: SECTION_ID, position: 1 }]);
    await service.reorderSections(REV_ID, [SECTION_ID, ITEM_ID]);
    expect(tx.cmsSection.update).toHaveBeenNthCalledWith(1, { where: { id: SECTION_ID }, data: { position: -1 } });
    expect(tx.cmsSection.update).toHaveBeenNthCalledWith(2, { where: { id: ITEM_ID }, data: { position: -2 } });
    expect(tx.cmsSection.update).toHaveBeenNthCalledWith(3, { where: { id: SECTION_ID }, data: { position: 0 } });
    expect(tx.cmsSection.update).toHaveBeenNthCalledWith(4, { where: { id: ITEM_ID }, data: { position: 1 } });
  });

  it('maps section unique-key and position conflicts', async () => {
    tx.cmsSection.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.createSection(REV_ID, { key: 'hero', type: 'hero', position: 0, content: {} }, undefined, USER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves explicit nullable fields while leaving omitted item fields untouched', async () => {
    prisma.cmsSectionItem.findUnique.mockResolvedValue({ section: { revisionId: REV_ID } });
    await service.updateItem(ITEM_ID, { title: null, categoryId: null });
    expect(tx.cmsSectionItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { title: null, categoryId: null },
    });
  });

  it('validates optional category references before creating section items', async () => {
    tx.category.findUnique.mockResolvedValue(null);
    await expect(service.createItem(SECTION_ID, { position: 0, categoryId: DOC_ID })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.cmsSectionItem.create).not.toHaveBeenCalled();
  });

  it('reorders section items and rejects incomplete reorder lists', async () => {
    tx.cmsSection.findUnique.mockResolvedValue({ revisionId: REV_ID });
    tx.cmsSectionItem.findMany
      .mockResolvedValueOnce([{ id: ITEM_ID, position: 0 }])
      .mockResolvedValueOnce([{ id: ITEM_ID, position: 0 }])
      .mockResolvedValueOnce([{ id: ITEM_ID, position: 0 }]);
    await service.reorderItems(SECTION_ID, [ITEM_ID]);
    expect(tx.cmsSectionItem.update).toHaveBeenCalledTimes(2);
    await expect(service.reorderItems(SECTION_ID, [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cleans a newly uploaded image if its database write fails', async () => {
    tx.cmsSection.create.mockRejectedValueOnce(new Error('write failed'));
    const file = { buffer: Buffer.from('image') } as Express.Multer.File;
    await expect(service.createSection(REV_ID, { key: 'hero', type: 'hero', position: 0, content: {} }, file, USER_ID)).rejects.toThrow('write failed');
    expect(uploads.deleteCmsImage).toHaveBeenCalledWith('ecommerce/cms/users/u/cms');
  });

  it('retains a replaced image while any revision or section still references it', async () => {
    prisma.cmsSection.findUnique.mockResolvedValue({ revisionId: REV_ID });
    tx.cmsSection.findUnique.mockResolvedValue({ imagePublicId: 'ecommerce/cms/users/u/shared' });
    tx.cmsSection.update.mockResolvedValue({ id: SECTION_ID });
    prisma.cmsSection.findFirst.mockResolvedValue({ id: 'another-section' });
    const file = { buffer: Buffer.from('image') } as Express.Multer.File;
    await service.updateSection(SECTION_ID, {}, file, USER_ID);
    expect(prisma.cmsSection.findFirst).toHaveBeenCalledWith({
      where: { imagePublicId: 'ecommerce/cms/users/u/shared' },
      select: { id: true },
    });
    expect(uploads.deleteCmsImage).not.toHaveBeenCalled();
  });

  it('retains an Open Graph image still referenced by a published revision', async () => {
    prisma.cmsRevision.findUnique.mockResolvedValue({ status: CmsRevisionStatus.DRAFT });
    tx.cmsRevision.findUnique
      .mockResolvedValueOnce({ status: CmsRevisionStatus.DRAFT })
      .mockResolvedValueOnce({ ogImagePublicId: 'ecommerce/cms/users/u/shared-og' });
    tx.cmsRevision.update.mockResolvedValue({ id: REV_ID });
    prisma.cmsRevision.findFirst.mockResolvedValue({ id: 'published-revision' });
    const file = { buffer: Buffer.from('image') } as Express.Multer.File;

    await service.updateRevision(REV_ID, {}, file, USER_ID);

    expect(prisma.cmsRevision.findFirst).toHaveBeenCalledWith({
      where: { ogImagePublicId: 'ecommerce/cms/users/u/shared-og' },
      select: { id: true },
    });
    expect(uploads.deleteCmsImage).not.toHaveBeenCalled();
  });
});

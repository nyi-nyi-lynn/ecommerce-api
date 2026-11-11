import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CmsRevisionStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { buildPaginatedResponse, resolvePaginationParams } from '../common/pagination/pagination.util.js';
import { hasPrismaErrorCode } from '../common/prisma/prisma-error.util.js';
import type { QueryCmsDocumentsDto } from './dto/query-cms-documents.dto.js';
import type { QueryCmsRevisionsDto } from './dto/query-cms-revisions.dto.js';
import type { CreateCmsDocumentDto } from './dto/create-cms-document.dto.js';
import type { UpdateCmsDocumentDto } from './dto/update-cms-document.dto.js';
import type { CreateCmsRevisionDto } from './dto/create-cms-revision.dto.js';
import type { UpdateCmsRevisionDto } from './dto/update-cms-revision.dto.js';
import type { CreateCmsSectionDto } from './dto/create-cms-section.dto.js';
import type { UpdateCmsSectionDto } from './dto/update-cms-section.dto.js';
import type { CreateCmsSectionItemDto } from './dto/create-cms-section-item.dto.js';
import type { UpdateCmsSectionItemDto } from './dto/update-cms-section-item.dto.js';
import { isCmsJsonObject } from './dto/cms-content.transforms.js';

type CmsTransaction = Prisma.TransactionClient;
type UploadedCmsImage = { secure_url: string; public_id: string };

@Injectable()
export class CmsService {
  private readonly logger = new Logger(CmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async listDocuments(query: QueryCmsDocumentsDto) {
    const { page, limit, skip } = resolvePaginationParams(query);
    const where: Prisma.CmsDocumentWhereInput = query.search
      ? {
          OR: [
            { key: { contains: query.search, mode: 'insensitive' } },
            { title: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.cmsDocument.findMany({
        where,
        orderBy: [{ key: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.cmsDocument.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, page, limit);
  }

  async publishDocument(documentId: string, publisherId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // This is the same parent-row lock used by revision creation. It
          // serializes publishers and draft creation for this document.
          await this.lockDocument(tx, documentId);
          const document = await tx.cmsDocument.findUnique({
            where: { id: documentId },
            select: { id: true, key: true, title: true },
          });
          if (!document) throw new NotFoundException('CMS document not found.');

          const draft = await tx.cmsRevision.findFirst({
            where: { documentId, status: CmsRevisionStatus.DRAFT },
            select: { id: true },
          });
          if (!draft) {
            throw new ConflictException('The CMS document has no DRAFT revision to publish.');
          }

          // Draft editors lock this row before changing content. Waiting for
          // that lock ensures validation sees the committed draft contents.
          await this.lockDraftRevision(tx, draft.id);
          const content = await tx.cmsRevision.findUnique({
            where: { id: draft.id },
            select: {
              sections: {
                select: {
                  key: true,
                  type: true,
                  position: true,
                  content: true,
                  items: { select: { position: true } },
                },
              },
            },
          });
          if (!content) throw new NotFoundException('CMS revision not found.');
          this.validatePublishableContent(content.sections);

          const previousPublished = await tx.cmsRevision.findFirst({
            where: { documentId, status: CmsRevisionStatus.PUBLISHED },
            select: { id: true },
          });
          if (previousPublished) {
            await tx.cmsRevision.update({
              where: { id: previousPublished.id },
              data: { status: CmsRevisionStatus.ARCHIVED },
            });
          }

          const revision = await tx.cmsRevision.update({
            where: { id: draft.id },
            data: {
              status: CmsRevisionStatus.PUBLISHED,
              publishedAt: new Date(),
              publishedById: publisherId,
            },
            include: {
              sections: {
                orderBy: [{ position: 'asc' }, { id: 'asc' }],
                include: {
                  items: {
                    orderBy: [{ position: 'asc' }, { id: 'asc' }],
                    include: { category: { select: { id: true, name: true, slug: true } } },
                  },
                },
              },
            },
          });
          return { document, revision };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error: unknown) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A revision was published concurrently. Refresh and try again.');
      }
      throw error;
    }
  }

  async getDraftPreview(documentId: string) {
    const document = await this.prisma.cmsDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        key: true,
        title: true,
        revisions: {
          where: { status: CmsRevisionStatus.DRAFT },
          take: 1,
          select: {
            id: true,
            revisionNumber: true,
            status: true,
            seoTitle: true,
            seoDescription: true,
            ogImageUrl: true,
            ogImagePublicId: true,
            sections: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              include: {
                items: {
                  orderBy: [{ position: 'asc' }, { id: 'asc' }],
                  include: { category: { select: { id: true, name: true, slug: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!document) throw new NotFoundException('CMS document not found.');
    const revision = document.revisions[0];
    if (!revision) throw new NotFoundException('CMS DRAFT revision not found.');
    return { document: { id: document.id, key: document.key, title: document.title }, revision };
  }

  async listPublishedPages(query: QueryCmsDocumentsDto) {
    const { page, limit, skip } = resolvePaginationParams(query);
    const where: Prisma.CmsDocumentWhereInput = {
      revisions: { some: { status: CmsRevisionStatus.PUBLISHED } },
      ...(query.search && {
        OR: [
          { key: { contains: query.search, mode: 'insensitive' } },
          { title: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [documents, total] = await Promise.all([
      this.prisma.cmsDocument.findMany({
        where,
        orderBy: [{ key: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
        select: {
          key: true,
          title: true,
          revisions: {
            where: { status: CmsRevisionStatus.PUBLISHED },
            take: 1,
            select: { seoTitle: true, seoDescription: true, ogImageUrl: true },
          },
        },
      }),
      this.prisma.cmsDocument.count({ where }),
    ]);
    const items = documents.map(({ key, title, revisions }) => ({
      key,
      title,
      seoTitle: revisions[0]?.seoTitle ?? null,
      seoDescription: revisions[0]?.seoDescription ?? null,
      ogImageUrl: revisions[0]?.ogImageUrl ?? null,
    }));
    return buildPaginatedResponse(items, total, page, limit);
  }

  async getPublishedPage(key: string) {
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(key) || key.length > 100) {
      throw new BadRequestException('key must be a valid CMS document key.');
    }
    const document = await this.prisma.cmsDocument.findFirst({
      where: {
        key,
        revisions: { some: { status: CmsRevisionStatus.PUBLISHED } },
      },
      select: {
        key: true,
        title: true,
        revisions: {
          where: { status: CmsRevisionStatus.PUBLISHED },
          take: 1,
          select: {
            seoTitle: true,
            seoDescription: true,
            ogImageUrl: true,
            sections: {
              where: { isVisible: true },
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              select: {
                key: true,
                type: true,
                position: true,
                content: true,
                imageUrl: true,
                items: {
                  orderBy: [{ position: 'asc' }, { id: 'asc' }],
                  select: {
                    position: true,
                    title: true,
                    body: true,
                    url: true,
                    label: true,
                    category: { select: { id: true, name: true, slug: true, imageUrl: true, isActive: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const revision = document?.revisions[0];
    if (!document || !revision) throw new NotFoundException('Published CMS page not found.');
    return {
      key: document.key,
      title: document.title,
      seoTitle: revision.seoTitle,
      seoDescription: revision.seoDescription,
      ogImageUrl: revision.ogImageUrl,
      sections: revision.sections.map((section) => ({
        key: section.key,
        type: section.type,
        position: section.position,
        content: section.content,
        imageUrl: section.imageUrl,
        items: section.items.map(({ category, ...item }) => ({
          ...item,
          category: category?.isActive
            ? { id: category.id, name: category.name, slug: category.slug, imageUrl: category.imageUrl }
            : null,
        })),
      })),
    };
  }

  async getDocument(id: string) {
    const document = await this.prisma.cmsDocument.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('CMS document not found.');
    return document;
  }

  async getDocumentByKey(key: string) {
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(key) || key.length > 100) {
      throw new BadRequestException('key must be a valid CMS document key.');
    }
    const document = await this.prisma.cmsDocument.findUnique({ where: { key } });
    if (!document) throw new NotFoundException('CMS document not found.');
    return document;
  }

  async createDocument(dto: CreateCmsDocumentDto) {
    try {
      return await this.prisma.cmsDocument.create({
        data: { key: dto.key, title: dto.title },
      });
    } catch (error: unknown) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A CMS document with this key already exists.');
      }
      throw error;
    }
  }

  async updateDocument(id: string, dto: UpdateCmsDocumentDto) {
    if (dto.title === undefined) throw new BadRequestException('At least one document field must be supplied.');
    try {
      return await this.prisma.cmsDocument.update({
        where: { id },
        data: { title: dto.title },
      });
    } catch (error: unknown) {
      if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS document not found.');
      if (hasPrismaErrorCode(error, 'P2003')) {
        throw new ConflictException('A CMS document with revision history cannot be deleted.');
      }
      throw error;
    }
  }

  async deleteDocument(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "CmsDocument" WHERE "id" = ${id}::uuid FOR UPDATE
        `;
        if (!locked.length) throw new NotFoundException('CMS document not found.');
        const revisions = await tx.cmsRevision.count({ where: { documentId: id } });
        if (revisions > 0) {
          throw new ConflictException('A CMS document with revision history cannot be deleted.');
        }
        return tx.cmsDocument.delete({ where: { id } });
      });
    } catch (error: unknown) {
      if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS document not found.');
      throw error;
    }
  }

  async listRevisions(documentId: string, query: QueryCmsRevisionsDto) {
    const { page, limit, skip } = resolvePaginationParams(query);
    const where: Prisma.CmsRevisionWhereInput = {
      documentId,
      ...(query.status !== undefined && { status: query.status }),
    };
    const exists = await this.prisma.cmsDocument.findUnique({
      where: { id: documentId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('CMS document not found.');
    const [items, total] = await Promise.all([
      this.prisma.cmsRevision.findMany({
        where,
        orderBy: [{ revisionNumber: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.cmsRevision.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, page, limit);
  }

  async createRevision(documentId: string, dto: CreateCmsRevisionDto, file: Express.Multer.File | undefined, actorId: string) {
    if (!(await this.prisma.cmsDocument.findUnique({ where: { id: documentId }, select: { id: true } }))) {
      throw new NotFoundException('CMS document not found.');
    }
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockDocument(tx, documentId);
        const latest = await tx.cmsRevision.findFirst({
          where: { documentId },
          orderBy: { revisionNumber: 'desc' },
          select: { revisionNumber: true },
        });
        if (latest && latest.revisionNumber >= 2_147_483_647) {
          throw new ConflictException('The CMS document has reached the revision-number limit.');
        }
        const data = {
          documentId,
          revisionNumber: (latest?.revisionNumber ?? 0) + 1,
          status: CmsRevisionStatus.DRAFT,
          seoTitle: dto.seoTitle ?? null,
          seoDescription: dto.seoDescription ?? null,
          ogImageUrl: uploaded?.secure_url ?? null,
          ogImagePublicId: uploaded?.public_id ?? null,
          createdById: actorId,
        };
        return tx.cmsRevision.create({ data });
      });
    } catch (error: unknown) {
      await this.cleanupUploaded(uploaded);
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A draft revision already exists or the revision number conflicted.');
      }
      throw error;
    }
  }

  async getRevision(id: string) {
    const revision = await this.prisma.cmsRevision.findUnique({
      where: { id },
      include: {
        sections: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: {
            items: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              include: { category: { select: { id: true, name: true, slug: true } } },
            },
          },
        },
      },
    });
    if (!revision) throw new NotFoundException('CMS revision not found.');
    return revision;
  }

  async updateRevision(id: string, dto: UpdateCmsRevisionDto, file: Express.Multer.File | undefined, actorId: string) {
    if (!this.hasRevisionUpdate(dto, file)) throw new BadRequestException('At least one revision field must be supplied.');
    await this.assertDraftRevision(this.prisma, id);
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      const { updated, previous } = await this.prisma.$transaction(async (tx) => {
        await this.lockDraftRevision(tx, id);
        const previous = await tx.cmsRevision.findUnique({ where: { id }, select: { ogImagePublicId: true } });
        if (!previous) throw new NotFoundException('CMS revision not found.');
        const updated = await tx.cmsRevision.update({
          where: { id },
          data: {
            ...(dto.seoTitle !== undefined && { seoTitle: dto.seoTitle }),
            ...(dto.seoDescription !== undefined && { seoDescription: dto.seoDescription }),
            ...(uploaded && { ogImageUrl: uploaded.secure_url, ogImagePublicId: uploaded.public_id }),
          },
        });
        return { updated, previous };
      });
      if (uploaded && previous.ogImagePublicId && previous.ogImagePublicId !== uploaded.public_id) {
        await this.cleanupIfUnreferenced(previous.ogImagePublicId);
      }
      return updated;
    } catch (error: unknown) {
      await this.cleanupUploaded(uploaded);
      if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS revision not found.');
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('CMS revision conflicts with an existing revision.');
      throw error;
    }
  }

  async deleteRevision(id: string) {
    const removedAssets: string[] = [];
    const revision = await this.prisma.$transaction(async (tx) => {
      await this.lockDraftRevision(tx, id);
      const existing = await tx.cmsRevision.findUnique({
        where: { id },
        select: { id: true, ogImagePublicId: true, sections: { select: { id: true, imagePublicId: true, items: { select: { id: true } } } } },
      });
      if (!existing) throw new NotFoundException('CMS revision not found.');
      if (existing.ogImagePublicId) removedAssets.push(existing.ogImagePublicId);
      for (const section of existing.sections) {
        if (section.imagePublicId) removedAssets.push(section.imagePublicId);
        await tx.cmsSectionItem.deleteMany({ where: { sectionId: section.id } });
      }
      await tx.cmsSection.deleteMany({ where: { revisionId: id } });
      return tx.cmsRevision.delete({ where: { id } });
    });
    await this.cleanupManyIfUnreferenced(removedAssets);
    return revision;
  }

  async listSections(revisionId: string) {
    if (!(await this.prisma.cmsRevision.findUnique({ where: { id: revisionId }, select: { id: true } }))) {
      throw new NotFoundException('CMS revision not found.');
    }
    return this.prisma.cmsSection.findMany({
      where: { revisionId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
  }

  async createSection(revisionId: string, dto: CreateCmsSectionDto, file: Express.Multer.File | undefined, actorId: string) {
    this.validateContent(dto.content);
    await this.assertDraftRevision(this.prisma, revisionId);
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockDraftRevision(tx, revisionId);
        return tx.cmsSection.create({
          data: {
            revisionId,
            key: dto.key,
            type: dto.type,
            position: dto.position,
            isVisible: dto.isVisible ?? true,
            content: dto.content as Prisma.InputJsonValue,
            imageUrl: uploaded?.secure_url ?? null,
            imagePublicId: uploaded?.public_id ?? null,
          },
        });
      });
    } catch (error: unknown) {
      await this.cleanupUploaded(uploaded);
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('Section key or position already exists in this revision.');
      throw error;
    }
  }

  async getSection(id: string) {
    const section = await this.prisma.cmsSection.findUnique({
      where: { id },
      include: {
        revision: { select: { id: true, documentId: true, revisionNumber: true, status: true } },
        items: { orderBy: [{ position: 'asc' }, { id: 'asc' }], include: { category: { select: { id: true, name: true, slug: true } } } },
      },
    });
    if (!section) throw new NotFoundException('CMS section not found.');
    return section;
  }

  async updateSection(id: string, dto: UpdateCmsSectionDto, file: Express.Multer.File | undefined, actorId: string) {
    if (!this.hasSectionUpdate(dto, file)) throw new BadRequestException('At least one section field must be supplied.');
    if (dto.content !== undefined) this.validateContent(dto.content);
    const current = await this.prisma.cmsSection.findUnique({ where: { id }, select: { revisionId: true } });
    if (!current) throw new NotFoundException('CMS section not found.');
    await this.assertDraftRevision(this.prisma, current.revisionId);
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      const { updated, previous } = await this.prisma.$transaction(async (tx) => {
        await this.lockDraftRevision(tx, current.revisionId);
        const previous = await tx.cmsSection.findUnique({ where: { id }, select: { imagePublicId: true } });
        if (!previous) throw new NotFoundException('CMS section not found.');
        const updated = await tx.cmsSection.update({
          where: { id },
          data: {
            ...(dto.key !== undefined && { key: dto.key }),
            ...(dto.type !== undefined && { type: dto.type }),
            ...(dto.position !== undefined && { position: dto.position }),
            ...(dto.isVisible !== undefined && { isVisible: dto.isVisible }),
            ...(dto.content !== undefined && { content: dto.content as Prisma.InputJsonValue }),
            ...(uploaded && { imageUrl: uploaded.secure_url, imagePublicId: uploaded.public_id }),
          },
        });
        return { updated, previous };
      });
      if (uploaded && previous.imagePublicId && previous.imagePublicId !== uploaded.public_id) {
        await this.cleanupIfUnreferenced(previous.imagePublicId);
      }
      return updated;
    } catch (error: unknown) {
      await this.cleanupUploaded(uploaded);
      if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS section not found.');
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('Section key or position already exists in this revision.');
      throw error;
    }
  }

  async setSectionVisibility(id: string, isVisible: boolean) {
    return this.updateSection(id, { isVisible }, undefined, '');
  }

  async reorderSections(revisionId: string, ids: string[]) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraftRevision(tx, revisionId);
      const current = await tx.cmsSection.findMany({ where: { revisionId }, select: { id: true, position: true } });
      this.assertExactOrder(ids, current.map(({ id }) => id), current.map(({ position }) => position));
      for (let index = 0; index < ids.length; index++) {
        await tx.cmsSection.update({ where: { id: ids[index] }, data: { position: -(index + 1) } });
      }
      for (let index = 0; index < ids.length; index++) {
        await tx.cmsSection.update({ where: { id: ids[index] }, data: { position: index } });
      }
      return tx.cmsSection.findMany({ where: { revisionId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    });
  }

  async deleteSection(id: string) {
    const removedAsset = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cmsSection.findUnique({ where: { id }, select: { revisionId: true, imagePublicId: true } });
      if (!existing) throw new NotFoundException('CMS section not found.');
      await this.lockDraftRevision(tx, existing.revisionId);
      if (!(await tx.cmsSection.findUnique({ where: { id }, select: { id: true } }))) {
        throw new NotFoundException('CMS section not found.');
      }
      await tx.cmsSectionItem.deleteMany({ where: { sectionId: id } });
      try {
        await tx.cmsSection.delete({ where: { id } });
      } catch (error: unknown) {
        if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS section not found.');
        throw error;
      }
      return existing.imagePublicId;
    });
    if (removedAsset) await this.cleanupIfUnreferenced(removedAsset);
    return { id, deleted: true };
  }

  async listItems(sectionId: string) {
    if (!(await this.prisma.cmsSection.findUnique({ where: { id: sectionId }, select: { id: true } }))) {
      throw new NotFoundException('CMS section not found.');
    }
    return this.prisma.cmsSectionItem.findMany({
      where: { sectionId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { category: { select: { id: true, name: true, slug: true } } },
    });
  }

  async createItem(sectionId: string, dto: CreateCmsSectionItemDto) {
    const section = await this.prisma.cmsSection.findUnique({ where: { id: sectionId }, select: { id: true, revisionId: true } });
    if (!section) throw new NotFoundException('CMS section not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraftRevision(tx, section.revisionId);
      if (!(await tx.cmsSection.findUnique({ where: { id: sectionId }, select: { id: true } }))) {
        throw new NotFoundException('CMS section not found.');
      }
      if (dto.categoryId && !(await tx.category.findUnique({ where: { id: dto.categoryId }, select: { id: true } }))) {
        throw new BadRequestException('The selected category does not exist.');
      }
      try {
        return await tx.cmsSectionItem.create({
          data: {
            sectionId,
            position: dto.position,
            ...(dto.title !== undefined && { title: dto.title }),
            ...(dto.body !== undefined && { body: dto.body }),
            ...(dto.url !== undefined && { url: dto.url }),
            ...(dto.label !== undefined && { label: dto.label }),
            ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          },
        });
      } catch (error: unknown) {
        if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('Item position already exists in this section.');
        if (hasPrismaErrorCode(error, 'P2003')) throw new BadRequestException('The selected category does not exist.');
        throw error;
      }
    });
  }

  async getItem(id: string) {
    const item = await this.prisma.cmsSectionItem.findUnique({
      where: { id },
      include: {
        section: { select: { id: true, revisionId: true, key: true, revision: { select: { status: true } } } },
        category: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!item) throw new NotFoundException('CMS section item not found.');
    return item;
  }

  async updateItem(id: string, dto: UpdateCmsSectionItemDto) {
    if (!Object.values(dto).some((value) => value !== undefined)) throw new BadRequestException('At least one item field must be supplied.');
    const existing = await this.prisma.cmsSectionItem.findUnique({ where: { id }, select: { sectionId: true, section: { select: { revisionId: true } } } });
    if (!existing) throw new NotFoundException('CMS section item not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraftRevision(tx, existing.section.revisionId);
      if (dto.categoryId && !(await tx.category.findUnique({ where: { id: dto.categoryId }, select: { id: true } }))) {
        throw new BadRequestException('The selected category does not exist.');
      }
      try {
        return await tx.cmsSectionItem.update({ where: { id }, data: dto });
      } catch (error: unknown) {
        if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('Item position already exists in this section.');
        if (hasPrismaErrorCode(error, 'P2003')) throw new BadRequestException('The selected category does not exist.');
        if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS section item not found.');
        throw error;
      }
    });
  }

  async reorderItems(sectionId: string, ids: string[]) {
    const section = await this.prisma.cmsSection.findUnique({ where: { id: sectionId }, select: { revisionId: true } });
    if (!section) throw new NotFoundException('CMS section not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraftRevision(tx, section.revisionId);
      const current = await tx.cmsSectionItem.findMany({ where: { sectionId }, select: { id: true, position: true } });
      this.assertExactOrder(ids, current.map(({ id }) => id), current.map(({ position }) => position));
      for (let index = 0; index < ids.length; index++) {
        await tx.cmsSectionItem.update({ where: { id: ids[index] }, data: { position: -(index + 1) } });
      }
      for (let index = 0; index < ids.length; index++) {
        await tx.cmsSectionItem.update({ where: { id: ids[index] }, data: { position: index } });
      }
      return tx.cmsSectionItem.findMany({ where: { sectionId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    });
  }

  async deleteItem(id: string) {
    const existing = await this.prisma.cmsSectionItem.findUnique({ where: { id }, select: { section: { select: { revisionId: true } } } });
    if (!existing) throw new NotFoundException('CMS section item not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraftRevision(tx, existing.section.revisionId);
      try {
        return await tx.cmsSectionItem.delete({ where: { id } });
      } catch (error: unknown) {
        if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS section item not found.');
        throw error;
      }
    });
  }

  private async lockDocument(tx: CmsTransaction, documentId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CmsDocument" WHERE "id" = ${documentId}::uuid FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('CMS document not found.');
  }

  private async lockDraftRevision(tx: CmsTransaction, revisionId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CmsRevision" WHERE "id" = ${revisionId}::uuid FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('CMS revision not found.');
    const revision = await tx.cmsRevision.findUnique({ where: { id: revisionId }, select: { status: true } });
    if (!revision) throw new NotFoundException('CMS revision not found.');
    if (revision.status !== CmsRevisionStatus.DRAFT) {
      throw new ConflictException('Only DRAFT revisions can be modified.');
    }
  }

  private async assertDraftRevision(client: PrismaService | CmsTransaction, revisionId: string) {
    const revision = await client.cmsRevision.findUnique({ where: { id: revisionId }, select: { status: true } });
    if (!revision) throw new NotFoundException('CMS revision not found.');
    if (revision.status !== CmsRevisionStatus.DRAFT) throw new ConflictException('Only DRAFT revisions can be modified.');
  }

  private validateContent(value: unknown): asserts value is Record<string, unknown> {
    if (!isCmsJsonObject(value)) {
      throw new BadRequestException('content must be a JSON object.');
    }
  }

  private validatePublishableContent(
    sections: Array<{
      key: string;
      type: string;
      position: number;
      content: unknown;
      items: Array<{ position: number }>;
    }>,
  ) {
    // Phase 3 defines structured JSON objects but no section-type-specific
    // required fields. Validate the persisted structure without inventing
    // page-content requirements; hidden sections are valid revisions too.
    const valid = sections.every(
      (section) =>
        section.key.trim().length > 0 &&
        section.type.trim().length > 0 &&
        Number.isSafeInteger(section.position) &&
        section.position >= 0 &&
        isCmsJsonObject(section.content) &&
        section.items.every(
          (item) => Number.isSafeInteger(item.position) && item.position >= 0,
        ),
    );
    if (!valid) {
      throw new BadRequestException('The DRAFT revision contains invalid CMS section content.');
    }
  }

  private assertExactOrder(ids: string[], currentIds: string[], positions: number[]) {
    if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
      throw new BadRequestException('Reorder ids must contain every current item exactly once.');
    }
    if (positions.some((position) => position < 0)) {
      throw new ConflictException('Cannot reorder content with a negative stored position.');
    }
  }

  private hasRevisionUpdate(dto: UpdateCmsRevisionDto, file?: Express.Multer.File) {
    return file !== undefined || Object.values(dto).some((value) => value !== undefined);
  }

  private hasSectionUpdate(dto: UpdateCmsSectionDto, file?: Express.Multer.File) {
    return file !== undefined || Object.values(dto).some((value) => value !== undefined);
  }

  private async cleanupUploaded(image?: UploadedCmsImage) {
    if (!image) return;
    try {
      const success = await this.uploads.deleteCmsImage(image.public_id);
      if (!success) this.logger.error('New CMS image cleanup failed after a database error.');
    } catch {
      this.logger.error('New CMS image cleanup failed after a database error.');
    }
  }

  private async cleanupIfUnreferenced(publicId: string) {
    try {
      const [revisionReference, sectionReference] = await Promise.all([
        this.prisma.cmsRevision.findFirst({ where: { ogImagePublicId: publicId }, select: { id: true } }),
        this.prisma.cmsSection.findFirst({ where: { imagePublicId: publicId }, select: { id: true } }),
      ]);
      if (revisionReference || sectionReference) return;
      const deleted = await this.uploads.deleteCmsImage(publicId);
      if (!deleted) this.logger.error('Replaced CMS image cleanup failed.');
    } catch {
      // Retain the old asset when reference lookup or cleanup is unavailable.
      this.logger.error('Replaced CMS image cleanup could not be verified.');
    }
  }

  private async cleanupManyIfUnreferenced(publicIds: string[]) {
    for (const publicId of new Set(publicIds)) await this.cleanupIfUnreferenced(publicId);
  }
}

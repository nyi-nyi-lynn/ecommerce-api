import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CmsDocumentStatus, Prisma } from '../generated/prisma/client.js';
import { buildPaginatedResponse, resolvePaginationParams } from '../common/pagination/pagination.util.js';
import { hasPrismaErrorCode } from '../common/prisma/prisma-error.util.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCmsDocumentDto } from './dto/create-cms-document.dto.js';
import type { QueryCmsDocumentsDto } from './dto/query-cms-documents.dto.js';
import type { CreateCmsSectionDto } from './dto/create-cms-section.dto.js';
import type { UpdateCmsDocumentDto } from './dto/update-cms-document.dto.js';
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
    const where: Prisma.CmsDocumentWhereInput = {
      ...(query.status !== undefined && { status: query.status }),
      ...(query.search && {
        OR: [
          { key: { contains: query.search, mode: 'insensitive' } },
          { title: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
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

  async getDocument(id: string) {
    const document = await this.prisma.cmsDocument.findUnique({
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
    if (!document) throw new NotFoundException('CMS document not found.');
    return document;
  }

  async getDocumentByKey(key: string) {
    this.validateDocumentKey(key);
    const document = await this.prisma.cmsDocument.findUnique({ where: { key } });
    if (!document) throw new NotFoundException('CMS document not found.');
    return document;
  }

  async createDocument(
    dto: CreateCmsDocumentDto,
    file: Express.Multer.File | undefined,
    actorId: string,
  ) {
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      return await this.prisma.cmsDocument.create({
        data: {
          key: dto.key,
          title: dto.title,
          seoTitle: dto.seoTitle ?? null,
          seoDescription: dto.seoDescription ?? null,
          ogImageUrl: uploaded?.secure_url ?? null,
          ogImagePublicId: uploaded?.public_id ?? null,
          createdById: actorId,
        },
      });
    } catch (error: unknown) {
      await this.cleanupUploaded(uploaded);
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A CMS document with this key already exists.');
      }
      throw error;
    }
  }

  async updateDocument(
    id: string,
    dto: UpdateCmsDocumentDto,
    file: Express.Multer.File | undefined,
    actorId: string,
  ) {
    if (!this.hasDocumentUpdate(dto, file)) {
      throw new BadRequestException('At least one document field must be supplied.');
    }
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      const { updated, previous } = await this.prisma.$transaction(async (tx) => {
        await this.lockDocument(tx, id);
        const previous = await tx.cmsDocument.findUnique({
          where: { id },
          select: { ogImagePublicId: true },
        });
        if (!previous) throw new NotFoundException('CMS document not found.');
        const updated = await tx.cmsDocument.update({
          where: { id },
          data: {
            ...(dto.title !== undefined && { title: dto.title }),
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
      if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS document not found.');
      throw error;
    }
  }

  async deleteDocument(id: string) {
    const assets = await this.prisma.$transaction(async (tx) => {
      await this.lockDocument(tx, id);
      const document = await tx.cmsDocument.findUnique({
        where: { id },
        select: { ogImagePublicId: true, sections: { select: { imagePublicId: true } } },
      });
      if (!document) throw new NotFoundException('CMS document not found.');
      const publicIds = [document.ogImagePublicId, ...document.sections.map((section) => section.imagePublicId)]
        .filter((value): value is string => Boolean(value));
      await tx.cmsDocument.delete({ where: { id } });
      return publicIds;
    });
    await this.cleanupManyIfUnreferenced(assets);
    return { id, deleted: true };
  }

  async publishDocument(id: string, publisherId: string) {
    return this.changePublicationStatus(id, CmsDocumentStatus.DRAFT, CmsDocumentStatus.PUBLISHED, publisherId);
  }

  async unpublishDocument(id: string) {
    return this.changePublicationStatus(id, CmsDocumentStatus.PUBLISHED, CmsDocumentStatus.DRAFT);
  }

  async previewDocument(id: string) {
    return this.getDocument(id);
  }

  async listPublishedPages(query: QueryCmsDocumentsDto) {
    const { page, limit, skip } = resolvePaginationParams(query);
    const where: Prisma.CmsDocumentWhereInput = {
      status: CmsDocumentStatus.PUBLISHED,
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
        select: { key: true, title: true, seoTitle: true, seoDescription: true, ogImageUrl: true },
      }),
      this.prisma.cmsDocument.count({ where }),
    ]);
    return buildPaginatedResponse(documents, total, page, limit);
  }

  async getPublishedPage(key: string) {
    this.validateDocumentKey(key);
    const document = await this.prisma.cmsDocument.findUnique({
      where: { key, status: CmsDocumentStatus.PUBLISHED },
      select: {
        key: true,
        title: true,
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
    });
    if (!document) throw new NotFoundException('Published CMS page not found.');
    return {
      ...document,
      sections: document.sections.map((section) => ({
        ...section,
        items: section.items.map(({ category, ...item }) => ({
          ...item,
          category: category?.isActive
            ? { id: category.id, name: category.name, slug: category.slug, imageUrl: category.imageUrl }
            : null,
        })),
      })),
    };
  }

  async listSections(documentId: string) {
    if (!(await this.prisma.cmsDocument.findUnique({ where: { id: documentId }, select: { id: true } }))) {
      throw new NotFoundException('CMS document not found.');
    }
    return this.prisma.cmsSection.findMany({
      where: { documentId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
  }

  async createSection(
    documentId: string,
    dto: CreateCmsSectionDto,
    file: Express.Multer.File | undefined,
    actorId: string,
  ) {
    this.validateContent(dto.content);
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockDocument(tx, documentId);
        return tx.cmsSection.create({
          data: {
            documentId,
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
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('Section key or position already exists in this document.');
      if (hasPrismaErrorCode(error, 'P2003')) throw new NotFoundException('CMS document not found.');
      throw error;
    }
  }

  async getSection(id: string) {
    const section = await this.prisma.cmsSection.findUnique({
      where: { id },
      include: {
        document: { select: { id: true, key: true, status: true } },
        items: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: { category: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    if (!section) throw new NotFoundException('CMS section not found.');
    return section;
  }

  async updateSection(
    id: string,
    dto: UpdateCmsSectionDto,
    file: Express.Multer.File | undefined,
    actorId: string,
  ) {
    if (!this.hasContentUpdate(dto, file)) throw new BadRequestException('At least one section field must be supplied.');
    if (dto.content !== undefined) this.validateContent(dto.content);
    const existing = await this.prisma.cmsSection.findUnique({ where: { id }, select: { documentId: true } });
    if (!existing) throw new NotFoundException('CMS section not found.');
    const uploaded = file ? await this.uploads.uploadCmsImage(file, actorId) : undefined;
    try {
      const { updated, previous } = await this.prisma.$transaction(async (tx) => {
        await this.lockDocument(tx, existing.documentId);
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
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('Section key or position already exists in this document.');
      throw error;
    }
  }

  async setSectionVisibility(id: string, isVisible: boolean) {
    return this.updateSection(id, { isVisible }, undefined, '');
  }

  async reorderSections(documentId: string, ids: string[]) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocument(tx, documentId);
      const current = await tx.cmsSection.findMany({ where: { documentId }, select: { id: true, position: true } });
      this.assertExactOrder(ids, current.map(({ id }) => id), current.map(({ position }) => position));
      for (let index = 0; index < ids.length; index++) {
        await tx.cmsSection.update({ where: { id: ids[index] }, data: { position: -(index + 1) } });
      }
      for (let index = 0; index < ids.length; index++) {
        await tx.cmsSection.update({ where: { id: ids[index] }, data: { position: index } });
      }
      return tx.cmsSection.findMany({ where: { documentId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    });
  }

  async deleteSection(id: string) {
    const imagePublicId = await this.prisma.$transaction(async (tx) => {
      const before = await tx.cmsSection.findUnique({ where: { id }, select: { documentId: true } });
      if (!before) throw new NotFoundException('CMS section not found.');
      await this.lockDocument(tx, before.documentId);
      const section = await tx.cmsSection.findUnique({ where: { id }, select: { imagePublicId: true } });
      if (!section) throw new NotFoundException('CMS section not found.');
      await tx.cmsSection.delete({ where: { id } });
      return section.imagePublicId;
    });
    if (imagePublicId) await this.cleanupIfUnreferenced(imagePublicId);
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
    const section = await this.prisma.cmsSection.findUnique({ where: { id: sectionId }, select: { documentId: true } });
    if (!section) throw new NotFoundException('CMS section not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocument(tx, section.documentId);
      // Recheck after taking the document lock: the section may have been
      // deleted between the initial lookup and lock acquisition.
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
        section: { select: { id: true, documentId: true, key: true, document: { select: { status: true } } } },
        category: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!item) throw new NotFoundException('CMS section item not found.');
    return item;
  }

  async updateItem(id: string, dto: UpdateCmsSectionItemDto) {
    if (!Object.values(dto).some((value) => value !== undefined)) throw new BadRequestException('At least one item field must be supplied.');
    const existing = await this.prisma.cmsSectionItem.findUnique({
      where: { id },
      select: { section: { select: { documentId: true } } },
    });
    if (!existing) throw new NotFoundException('CMS section item not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocument(tx, existing.section.documentId);
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
    const section = await this.prisma.cmsSection.findUnique({ where: { id: sectionId }, select: { documentId: true } });
    if (!section) throw new NotFoundException('CMS section not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocument(tx, section.documentId);
      // A concurrent delete may have removed this section before the lock was
      // acquired. Report that state instead of treating its empty item list as
      // a valid reorder request.
      if (!(await tx.cmsSection.findUnique({ where: { id: sectionId }, select: { id: true } }))) {
        throw new NotFoundException('CMS section not found.');
      }
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
    const existing = await this.prisma.cmsSectionItem.findUnique({
      where: { id },
      select: { section: { select: { documentId: true } } },
    });
    if (!existing) throw new NotFoundException('CMS section item not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocument(tx, existing.section.documentId);
      try {
        return await tx.cmsSectionItem.delete({ where: { id } });
      } catch (error: unknown) {
        if (hasPrismaErrorCode(error, 'P2025')) throw new NotFoundException('CMS section item not found.');
        throw error;
      }
    });
  }

  private async changePublicationStatus(id: string, from: CmsDocumentStatus, to: CmsDocumentStatus, publisherId?: string) {
    const publishedAt = to === CmsDocumentStatus.PUBLISHED ? new Date() : null;
    const result = await this.prisma.cmsDocument.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        publishedAt,
        ...(publisherId && { publishedById: publisherId }),
      },
    });
    if (result.count === 0) {
      const current = await this.prisma.cmsDocument.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('CMS document not found.');
      if (current.status === to) return current;
      throw new ConflictException('CMS document publication status changed. Refresh and try again.');
    }
    return this.prisma.cmsDocument.findUniqueOrThrow({ where: { id } });
  }

  private async lockDocument(tx: CmsTransaction, documentId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CmsDocument" WHERE "id" = ${documentId}::uuid FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('CMS document not found.');
  }

  private validateDocumentKey(key: string) {
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(key) || key.length > 100) {
      throw new BadRequestException('key must be a valid CMS document key.');
    }
  }

  private validateContent(value: unknown): asserts value is Record<string, unknown> {
    if (!isCmsJsonObject(value)) throw new BadRequestException('content must be a JSON object.');
  }

  private assertExactOrder(ids: string[], currentIds: string[], positions: number[]) {
    if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
      throw new BadRequestException('Reorder ids must contain every current item exactly once.');
    }
    if (positions.some((position) => position < 0)) throw new ConflictException('Cannot reorder content with a negative stored position.');
  }

  private hasDocumentUpdate(dto: UpdateCmsDocumentDto, file?: Express.Multer.File) {
    return file !== undefined || Object.values(dto).some((value) => value !== undefined);
  }

  private hasContentUpdate(dto: UpdateCmsSectionDto, file?: Express.Multer.File) {
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
      const [documentReference, sectionReference] = await Promise.all([
        this.prisma.cmsDocument.findFirst({ where: { ogImagePublicId: publicId }, select: { id: true } }),
        this.prisma.cmsSection.findFirst({ where: { imagePublicId: publicId }, select: { id: true } }),
      ]);
      if (documentReference || sectionReference) return;
      const deleted = await this.uploads.deleteCmsImage(publicId);
      if (!deleted) this.logger.error('Replaced CMS image cleanup failed.');
    } catch {
      this.logger.error('Replaced CMS image cleanup could not be verified.');
    }
  }

  private async cleanupManyIfUnreferenced(publicIds: string[]) {
    for (const publicId of new Set(publicIds)) await this.cleanupIfUnreferenced(publicId);
  }
}

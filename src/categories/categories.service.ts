import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { hasPrismaErrorCode } from '../common/prisma/prisma-error.util.js';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly uploads?: UploadsService,
  ) {}

  // CREATE
  async create(
    dto: CreateCategoryDto,
    image?: Express.Multer.File,
    userId?: string,
  ) {
    let uploaded: { secure_url: string; public_id: string } | undefined;
    if (image) {
      if (!this.uploads)
        throw new ServiceUnavailableException(
          'Category image uploads are unavailable.',
        );
      uploaded = await this.uploads.uploadCategoryImage(image, userId);
    }
    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug.trim(),
          description: dto.description?.trim() || null,
          imageUrl: uploaded?.secure_url ?? null,
          imagePublicId: uploaded?.public_id ?? null,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error: unknown) {
      if (uploaded) await this.uploads?.deleteCategoryImage(uploaded.public_id);
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException(
          'A category with this name or slug already exists.',
        );
      }

      throw error;
    }
  }

  // READ ALL
  async findAll() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // READ ONE
  async findOne(id: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        id,
        isActive: true,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found.');
    }

    return category;
  }

  // UPDATE
  async update(
    id: string,
    dto: UpdateCategoryDto,
    image?: Express.Multer.File,
    userId?: string,
  ) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, imageUrl: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException('Category not found.');
    }

    let uploaded: { secure_url: string; public_id: string } | undefined;
    if (image) {
      if (!this.uploads)
        throw new ServiceUnavailableException(
          'Category image uploads are unavailable.',
        );
      uploaded = await this.uploads.uploadCategoryImage(image, userId);
    }

    const data = {
      ...(dto.name !== undefined && {
        name: dto.name.trim(),
      }),
      ...(dto.slug !== undefined && {
        slug: dto.slug.trim(),
      }),
      ...(dto.description !== undefined && {
        description:
          dto.description === null ? null : dto.description.trim() || null,
      }),
      ...(dto.isActive !== undefined && {
        isActive: dto.isActive,
      }),
      ...(uploaded && {
        imageUrl: uploaded.secure_url,
        imagePublicId: uploaded.public_id,
      }),
    };

    let updated;
    try {
      updated = await this.prisma.category.update({
        where: { id },
        data,
      });
    } catch (error: unknown) {
      if (uploaded) await this.uploads?.deleteCategoryImage(uploaded.public_id);
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException(
          'A category with this name or slug already exists.',
        );
      }

      if (hasPrismaErrorCode(error, 'P2025')) {
        throw new NotFoundException('Category not found.');
      }

      throw error;
    }

    if (
      uploaded &&
      existing.imagePublicId &&
      existing.imagePublicId !== uploaded.public_id
    ) {
      await this.uploads?.deleteCategoryImage(existing.imagePublicId);
    }
    return updated;
  }

  // DELETE
  async remove(id: string) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException('Category not found.');
    }

    try {
      const deleted = await this.prisma.category.delete({
        where: { id },
      });

      if (existing.imagePublicId?.trim()) {
        const cleanupSucceeded = await this.uploads?.deleteCategoryImage(
          existing.imagePublicId,
        );
        if (cleanupSucceeded === false) {
          this.logger.error(
            `Cloudinary category image cleanup failed for category ${id} and public ID ${existing.imagePublicId}.`,
          );
        }
      }

      return deleted;
    } catch (error: unknown) {
      if (hasPrismaErrorCode(error, 'P2025')) {
        throw new NotFoundException('Category not found.');
      }

      if (
        hasPrismaErrorCode(error, 'P2003') ||
        hasPrismaErrorCode(error, 'P2014')
      ) {
        throw new BadRequestException(
          'Cannot delete this category because products are linked to it.',
        );
      }

      throw error;
    }
  }
}

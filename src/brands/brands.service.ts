import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { QueryBrandsDto } from './dto/query-brands.dto.js';
import { UpdateBrandDto } from './dto/update-brand.dto.js';
import { hasPrismaErrorCode } from '../common/prisma/prisma-error.util.js';
import {
  buildPaginatedResponse,
  resolvePaginationParams,
} from '../common/pagination/pagination.util.js';

@Injectable()
export class BrandsService {
  private readonly logger = new Logger(BrandsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly uploads?: UploadsService,
  ) {}

  async create(
    dto: CreateBrandDto,
    image?: Express.Multer.File,
    userId?: string,
  ) {
    let uploaded: { secure_url: string; public_id: string } | undefined;
    if (image) {
      if (!this.uploads)
        throw new ServiceUnavailableException(
          'Brand image uploads are unavailable.',
        );
      uploaded = await this.uploads.uploadBrandImage(image, userId);
    }
    try {
      return await this.prisma.brand.create({
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
      if (uploaded) await this.uploads?.deleteBrandImage(uploaded.public_id);
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException(
          'A brand with this name or slug already exists.',
        );
      }

      throw error;
    }
  }

  async findAll(query: QueryBrandsDto = {}) {
    const where: Prisma.BrandWhereInput = {
      isActive: true,
      ...(query.search?.trim() && {
        name: { contains: query.search.trim(), mode: 'insensitive' },
      }),
    };
    const { page, limit, skip } = resolvePaginationParams(query);
    const orderBy = [
      { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      { id: 'asc' },
    ] as Prisma.BrandOrderByWithRelationInput[];
    const [items, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.brand.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findFirst({
      where: {
        id,
        isActive: true,
      },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found.');
    }

    return brand;
  }

  async update(
    id: string,
    dto: UpdateBrandDto,
    image?: Express.Multer.File,
    userId?: string,
  ) {
    const existing = await this.prisma.brand.findUnique({
      where: { id },
      select: { id: true, imageUrl: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException('Brand not found.');
    }

    let uploaded: { secure_url: string; public_id: string } | undefined;
    if (image) {
      if (!this.uploads)
        throw new ServiceUnavailableException(
          'Brand image uploads are unavailable.',
        );
      uploaded = await this.uploads.uploadBrandImage(image, userId);
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
      updated = await this.prisma.brand.update({
        where: { id },
        data,
      });
    } catch (error: unknown) {
      if (uploaded) await this.uploads?.deleteBrandImage(uploaded.public_id);
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException(
          'A brand with this name or slug already exists.',
        );
      }

      if (hasPrismaErrorCode(error, 'P2025')) {
        throw new NotFoundException('Brand not found.');
      }

      throw error;
    }

    if (
      uploaded &&
      existing.imagePublicId &&
      existing.imagePublicId !== uploaded.public_id
    ) {
      await this.uploads?.deleteBrandImage(existing.imagePublicId);
    }
    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.brand.findUnique({
      where: { id },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException('Brand not found.');
    }

    try {
      const deleted = await this.prisma.brand.delete({
        where: { id },
      });

      if (existing.imagePublicId?.trim()) {
        const cleanupSucceeded = await this.uploads?.deleteBrandImage(
          existing.imagePublicId,
        );
        if (cleanupSucceeded === false) {
          this.logger.error(
            `Cloudinary brand image cleanup failed for brand ${id} and public ID ${existing.imagePublicId}.`,
          );
        }
      }

      return deleted;
    } catch (error: unknown) {
      if (hasPrismaErrorCode(error, 'P2025')) {
        throw new NotFoundException('Brand not found.');
      }

      if (
        hasPrismaErrorCode(error, 'P2003') ||
        hasPrismaErrorCode(error, 'P2014')
      ) {
        throw new BadRequestException(
          'Cannot delete this brand because products are linked to it.',
        );
      }

      throw error;
    }
  }
}

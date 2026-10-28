import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // CREATE
  async create(dto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug.trim(),
          description: dto.description?.trim() || null,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error: unknown) {
      if (this.hasPrismaCode(error, 'P2002')) {
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
  async findOne(id: number) {
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
  async update(id: number, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Category not found.');
    }

    const data = {
      ...(dto.name !== undefined && {
        name: dto.name.trim(),
      }),
      ...(dto.slug !== undefined && {
        slug: dto.slug.trim(),
      }),
      ...(dto.description !== undefined && {
        description: dto.description.trim() || null,
      }),
      ...(dto.isActive !== undefined && {
        isActive: dto.isActive,
      }),
    };

    try {
      return await this.prisma.category.update({
        where: { id },
        data,
      });
    } catch (error: unknown) {
      if (this.hasPrismaCode(error, 'P2002')) {
        throw new ConflictException(
          'A category with this name or slug already exists.',
        );
      }

      if (this.hasPrismaCode(error, 'P2025')) {
        throw new NotFoundException('Category not found.');
      }

      throw error;
    }
  }

  // DELETE
  async remove(id: number) {
    try {
      return await this.prisma.category.delete({
        where: { id },
      });
    } catch (error: unknown) {
      if (this.hasPrismaCode(error, 'P2025')) {
        throw new NotFoundException('Category not found.');
      }

      if (
        this.hasPrismaCode(error, 'P2003') ||
        this.hasPrismaCode(error, 'P2014')
      ) {
        throw new BadRequestException(
          'Cannot delete this category because products are linked to it.',
        );
      }

      throw error;
    }
  }

  private hasPrismaCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
}

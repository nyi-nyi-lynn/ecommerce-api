import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { QueryProductsDto } from './dto/query-products.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    await this.ensureCategory(dto.categoryId);
    await this.ensureUnique(dto.sku.trim(), dto.slug.trim());
    try {
      return await this.prisma.product.create({ data: this.createData(dto) });
    } catch (error) {
      if (this.hasCode(error, 'P2002')) throw new ConflictException('A product with this SKU or slug already exists.');
      if (this.hasCode(error, 'P2003')) throw new UnprocessableEntityException('The selected category does not exist.');
      throw error;
    }
  }

  async update(id: number, dto: UpdateProductDto) {
    if (!(await this.prisma.product.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException('Product not found.');
    }
    if (dto.categoryId !== undefined) await this.ensureCategory(dto.categoryId);
    await this.ensureUnique(dto.sku?.trim(), dto.slug?.trim(), id);
    const data: Prisma.ProductUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.slug !== undefined && { slug: dto.slug.trim() }),
      ...(dto.sku !== undefined && { sku: dto.sku.trim() }),
      ...(dto.description !== undefined && { description: dto.description.trim() || null }),
      ...(dto.price !== undefined && { price: new Prisma.Decimal(dto.price) }),
      ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.categoryId !== undefined && { category: { connect: { id: dto.categoryId } } }),
    };
    try {
      return await this.prisma.product.update({ where: { id }, data });
    } catch (error) {
      if (this.hasCode(error, 'P2002')) throw new ConflictException('A product with this SKU or slug already exists.');
      if (this.hasCode(error, 'P2025')) throw new NotFoundException('Product not found.');
      if (this.hasCode(error, 'P2003')) throw new UnprocessableEntityException('The selected category does not exist.');
      throw error;
    }
  }

  async findAll(query: QueryProductsDto) {
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
      throw new UnprocessableEntityException('minPrice must not exceed maxPrice.');
    }
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(query.categoryId !== undefined && { categoryId: query.categoryId }),
      ...((query.minPrice !== undefined || query.maxPrice !== undefined) && {
        price: {
          ...(query.minPrice !== undefined && { gte: new Prisma.Decimal(query.minPrice) }),
          ...(query.maxPrice !== undefined && { lte: new Prisma.Decimal(query.maxPrice) }),
        },
      }),
      ...(query.search?.trim() && { name: { contains: query.search.trim(), mode: 'insensitive' } }),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const orderBy = [{ [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' }, { id: 'asc' }] as Prisma.ProductOrderByWithRelationInput[];
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy }),
      this.prisma.product.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findFirst({ where: { id, isActive: true } });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({ where: { slug, isActive: true } });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  private createData(dto: CreateProductDto): Prisma.ProductCreateInput {
    return {
      name: dto.name.trim(), slug: dto.slug.trim(), sku: dto.sku.trim(),
      description: dto.description?.trim() || null, price: new Prisma.Decimal(dto.price),
      imageUrl: dto.imageUrl ?? null, category: { connect: { id: dto.categoryId } },
    };
  }

  private async ensureCategory(categoryId: number) {
    if (!(await this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
      throw new UnprocessableEntityException('The selected category does not exist.');
    }
  }

  private async ensureUnique(sku?: string, slug?: string, excludeId?: number) {
    if (!sku && !slug) return;
    const duplicate = await this.prisma.product.findFirst({
      where: { ...(excludeId !== undefined && { id: { not: excludeId } }), OR: [
        ...(sku ? [{ sku }] : []), ...(slug ? [{ slug }] : []),
      ] }, select: { id: true },
    });
    if (duplicate) throw new ConflictException('A product with this SKU or slug already exists.');
  }

  private hasCode(error: unknown, code: string) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}

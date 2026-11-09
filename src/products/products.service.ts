import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { QueryProductsDto } from './dto/query-products.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { hasPrismaErrorCode } from '../common/prisma/prisma-error.util.js';
import {
  buildPaginatedResponse,
  resolvePaginationParams,
} from '../common/pagination/pagination.util.js';

const productWriteInclude = {
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
    },
  },
  brand: {
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
    },
  },
} satisfies Prisma.ProductInclude;

const publicProductInclude = {
  ...productWriteInclude,
  stock: {
    select: {
      quantity: true,
      reservedQuantity: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly uploads?: UploadsService,
  ) {}

  async create(
    dto: CreateProductDto,
    image?: Express.Multer.File,
    userId?: string,
  ) {
    this.validatePricing(
      new Prisma.Decimal(dto.price),
      dto.originalPrice !== undefined && dto.originalPrice !== null
        ? new Prisma.Decimal(dto.originalPrice)
        : null,
    );
    await this.ensureCategory(dto.categoryId);
    if (dto.brandId !== undefined && dto.brandId !== null) {
      await this.ensureBrand(dto.brandId);
    }
    await this.ensureUnique(dto.sku.trim(), dto.slug.trim());
    let uploaded: { secure_url: string; public_id: string } | undefined;
    if (image) {
      if (!this.uploads)
        throw new ServiceUnavailableException(
          'Product image uploads are unavailable.',
        );
      uploaded = await this.uploads.uploadProductImage(image, userId);
    }
    try {
      const created = await this.prisma.product.create({
        data: this.createData(dto, uploaded),
        include: productWriteInclude,
      });
      return this.mapProductResponse(created);
    } catch (error) {
      if (uploaded) await this.uploads?.deleteProductImage(uploaded.public_id);
      if (hasPrismaErrorCode(error, 'P2002'))
        throw new ConflictException(
          'A product with this SKU or slug already exists.',
        );
      if (hasPrismaErrorCode(error, 'P2003'))
        throw new UnprocessableEntityException(
          'The selected category or brand does not exist.',
        );
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    image?: Express.Multer.File,
    userId?: string,
  ) {
    const current = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        price: true,
        originalPrice: true,
        imageUrl: true,
        imagePublicId: true,
      },
    });
    if (!current) {
      throw new NotFoundException('Product not found.');
    }
    const effectivePrice =
      dto.price !== undefined
        ? new Prisma.Decimal(dto.price)
        : current.price !== undefined && current.price !== null
          ? new Prisma.Decimal(current.price.toString())
          : undefined;
    const effectiveOriginalPrice =
      dto.originalPrice === null
        ? null
        : dto.originalPrice !== undefined
          ? new Prisma.Decimal(dto.originalPrice)
          : current.originalPrice !== undefined &&
              current.originalPrice !== null
            ? new Prisma.Decimal(current.originalPrice.toString())
            : null;
    if (dto.price !== undefined || dto.originalPrice !== undefined) {
      this.validatePricing(effectivePrice, effectiveOriginalPrice);
    }
    if (dto.categoryId !== undefined) await this.ensureCategory(dto.categoryId);
    if (dto.brandId !== undefined && dto.brandId !== null) {
      await this.ensureBrand(dto.brandId);
    }
    await this.ensureUnique(dto.sku?.trim(), dto.slug?.trim(), id);
    let uploaded: { secure_url: string; public_id: string } | undefined;
    if (image) {
      if (!this.uploads)
        throw new ServiceUnavailableException(
          'Product image uploads are unavailable.',
        );
      uploaded = await this.uploads.uploadProductImage(image, userId);
    }
    const data: Prisma.ProductUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.slug !== undefined && { slug: dto.slug.trim() }),
      ...(dto.sku !== undefined && { sku: dto.sku.trim() }),
      ...(dto.description !== undefined && {
        description: dto.description ? dto.description.trim() || null : null,
      }),
      ...(dto.price !== undefined && { price: new Prisma.Decimal(dto.price) }),
      ...(dto.originalPrice !== undefined && {
        originalPrice:
          dto.originalPrice === null
            ? null
            : new Prisma.Decimal(dto.originalPrice),
      }),
      ...(uploaded
        ? { imageUrl: uploaded.secure_url, imagePublicId: uploaded.public_id }
        : dto.imageUrl !== undefined
          ? { imageUrl: dto.imageUrl, imagePublicId: null }
          : {}),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.categoryId !== undefined && {
        category: { connect: { id: dto.categoryId } },
      }),
      ...(dto.brandId !== undefined && {
        brand:
          dto.brandId === null
            ? { disconnect: true }
            : { connect: { id: dto.brandId } },
      }),
    };
    let updated;
    try {
      updated = await this.prisma.product.update({
        where: { id },
        data,
        include: productWriteInclude,
      });
    } catch (error) {
      if (uploaded) {
        await this.uploads?.deleteProductImage(uploaded.public_id);
      }
      if (hasPrismaErrorCode(error, 'P2002'))
        throw new ConflictException(
          'A product with this SKU or slug already exists.',
        );
      if (hasPrismaErrorCode(error, 'P2025'))
        throw new NotFoundException('Product not found.');
      if (hasPrismaErrorCode(error, 'P2003'))
        throw new UnprocessableEntityException(
          'The selected category or brand does not exist.',
        );
      throw error;
    }

    if (
      current.imagePublicId &&
      current.imagePublicId !== uploaded?.public_id &&
      (uploaded !== undefined || dto.imageUrl !== undefined)
    ) {
      await this.uploads?.deleteProductImage(current.imagePublicId);
    }
    return this.mapProductResponse(updated);
  }

  async findAll(query: QueryProductsDto) {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new UnprocessableEntityException(
        'minPrice must not exceed maxPrice.',
      );
    }
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(query.categoryId !== undefined && { categoryId: query.categoryId }),
      ...(query.brandId !== undefined && { brandId: query.brandId }),
      ...(query.brandSlug?.trim() && {
        brand: { slug: query.brandSlug.trim(), isActive: true },
      }),
      ...(query.hasDiscount !== undefined && {
        originalPrice: query.hasDiscount ? { not: null } : null,
      }),
      ...((query.minPrice !== undefined || query.maxPrice !== undefined) && {
        price: {
          ...(query.minPrice !== undefined && {
            gte: new Prisma.Decimal(query.minPrice),
          }),
          ...(query.maxPrice !== undefined && {
            lte: new Prisma.Decimal(query.maxPrice),
          }),
        },
      }),
      ...(query.search?.trim() && {
        name: { contains: query.search.trim(), mode: 'insensitive' },
      }),
    };
    const { page, limit, skip } = resolvePaginationParams(query);
    const orderBy = [
      { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      { id: 'asc' },
    ] as Prisma.ProductOrderByWithRelationInput[];
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: publicProductInclude,
      }),
      this.prisma.product.count({ where }),
    ]);
    return buildPaginatedResponse(
      items.map((item) => this.mapPublicProduct(item)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, isActive: true },
      include: publicProductInclude,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return this.mapPublicProduct(product);
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      include: publicProductInclude,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return this.mapPublicProduct(product);
  }

  private mapProductResponse<
    T extends {
      categoryId?: string | null;
      category?: {
        id: string;
        name: string;
        slug: string;
        imageUrl: string | null;
      } | null;
      brandId?: string | null;
      brand?: {
        id: string;
        name: string;
        slug: string;
        imageUrl: string | null;
      } | null;
      price?: Prisma.Decimal | number | string;
      originalPrice?: Prisma.Decimal | number | string | null;
    },
  >(product: T) {
    const {
      categoryId: _categoryId,
      brandId: _brandId,
      category: rawCategory,
      brand: rawBrand,
      ...rest
    } = product;
    const category = rawCategory
      ? {
          id: rawCategory.id,
          name: rawCategory.name,
          slug: rawCategory.slug,
          imageUrl: rawCategory.imageUrl ?? null,
        }
      : null;
    const brand = rawBrand
      ? {
          id: rawBrand.id,
          name: rawBrand.name,
          slug: rawBrand.slug,
          imageUrl: rawBrand.imageUrl ?? null,
        }
      : null;
    const originalPrice = rest.originalPrice ?? null;
    return {
      ...rest,
      category,
      brand,
      originalPrice,
      discountPercentage: this.calculateDiscountPercentage(
        rest.price,
        originalPrice,
      ),
    };
  }

  private mapPublicProduct<
    T extends {
      categoryId?: string | null;
      category?: {
        id: string;
        name: string;
        slug: string;
        imageUrl: string | null;
      } | null;
      brandId?: string | null;
      brand?: {
        id: string;
        name: string;
        slug: string;
        imageUrl: string | null;
      } | null;
      price?: Prisma.Decimal | number | string;
      originalPrice?: Prisma.Decimal | number | string | null;
      stock?: {
        quantity: number;
        reservedQuantity: number;
        updatedAt: Date;
      } | null;
    },
  >(product: T) {
    const { stock, ...rest } = product;
    const availableQuantity = stock
      ? stock.quantity - stock.reservedQuantity
      : 0;
    return {
      ...this.mapProductResponse(rest),
      stock: stock
        ? {
            availableQuantity,
            inStock: availableQuantity > 0,
            updatedAt: stock.updatedAt,
          }
        : {
            availableQuantity: 0,
            inStock: false,
          },
    };
  }

  private calculateDiscountPercentage(
    price?: Prisma.Decimal | number | string,
    originalPrice?: Prisma.Decimal | number | string | null,
  ): number | null {
    if (
      price === undefined ||
      price === null ||
      originalPrice === undefined ||
      originalPrice === null
    ) {
      return null;
    }
    const sellingPrice = new Prisma.Decimal(price.toString());
    const basePrice = new Prisma.Decimal(originalPrice.toString());
    if (basePrice.lte(0) || basePrice.lte(sellingPrice)) {
      return null;
    }
    return basePrice
      .minus(sellingPrice)
      .div(basePrice)
      .mul(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  private validatePricing(
    price: Prisma.Decimal | undefined,
    originalPrice: Prisma.Decimal | null,
  ) {
    if (price !== undefined && price.lte(0)) {
      throw new BadRequestException('price must be a positive monetary value.');
    }
    if (originalPrice !== null) {
      if (originalPrice.lte(0)) {
        throw new BadRequestException(
          'originalPrice must be a positive monetary value.',
        );
      }
      if (price !== undefined && originalPrice.lte(price)) {
        throw new BadRequestException(
          'originalPrice must be greater than price.',
        );
      }
    }
  }

  private createData(
    dto: CreateProductDto,
    uploaded?: { secure_url: string; public_id: string },
  ): Prisma.ProductCreateInput {
    return {
      name: dto.name.trim(),
      slug: dto.slug.trim(),
      sku: dto.sku.trim(),
      description: dto.description?.trim() || null,
      price: new Prisma.Decimal(dto.price),
      originalPrice:
        dto.originalPrice !== undefined && dto.originalPrice !== null
          ? new Prisma.Decimal(dto.originalPrice)
          : null,
      imageUrl: uploaded?.secure_url ?? dto.imageUrl ?? null,
      imagePublicId: uploaded?.public_id ?? null,
      category: { connect: { id: dto.categoryId } },
      ...(dto.brandId !== undefined &&
        dto.brandId !== null && {
          brand: { connect: { id: dto.brandId } },
        }),
    };
  }

  private async ensureCategory(categoryId: string) {
    if (
      !(await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { id: true },
      }))
    ) {
      throw new UnprocessableEntityException(
        'The selected category does not exist.',
      );
    }
  }

  private async ensureBrand(brandId: string) {
    if (typeof brandId !== 'string' || !isUUID(brandId)) {
      throw new BadRequestException('brandId must be a valid UUID.');
    }
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { id: true, isActive: true },
    });
    if (!brand) {
      throw new UnprocessableEntityException(
        'The selected brand does not exist.',
      );
    }
    if (!brand.isActive) {
      throw new UnprocessableEntityException(
        'The selected brand is inactive.',
      );
    }
  }

  private async ensureUnique(sku?: string, slug?: string, excludeId?: string) {
    if (!sku && !slug) return;
    const duplicate = await this.prisma.product.findFirst({
      where: {
        ...(excludeId !== undefined && { id: { not: excludeId } }),
        OR: [...(sku ? [{ sku }] : []), ...(slug ? [{ slug }] : [])],
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException(
        'A product with this SKU or slug already exists.',
      );
  }
}

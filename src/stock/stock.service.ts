import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdjustStockDto } from './dto/adjust-stock.dto.js';
import { InitializeStockDto } from './dto/initialize-stock.dto.js';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto.js';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async initialize(productId: number, dto: InitializeStockDto, actorId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
          throw new NotFoundException('Product not found.');
        }

        const stock = await tx.stock.create({
          data: { productId, quantity: dto.quantity },
        });
        await tx.stockMovement.create({
          data: {
            productId,
            userId: actorId,
            type: StockMovementType.INITIALIZATION,
            quantity: dto.quantity,
            quantityBefore: 0,
            quantityAfter: dto.quantity,
            note: 'Initial stock',
          },
        });
        return stock;
      });
    } catch (error) {
      if (this.hasCode(error, 'P2002')) {
        throw new ConflictException('Stock has already been initialized for this product.');
      }
      if (this.hasCode(error, 'P2003')) {
        throw new NotFoundException('Product not found.');
      }
      throw error;
    }
  }

  async adjust(productId: number, dto: AdjustStockDto, actorId: number) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, stock: { select: { productId: true } } },
      });
      if (!product) throw new NotFoundException('Product not found.');
      if (!product.stock) throw new NotFoundException('Stock has not been initialized for this product.');

      // Only positive changes consume headroom below INT4_MAX. Keep this bound in
      // PostgreSQL's integer range even when the requested change is negative.
      const maxQuantityBeforeIncrease =
        2_147_483_647 - Math.max(dto.quantityChange, 0);

      // This single conditional UPDATE takes a row lock and checks the resulting range atomically.
      // Competing adjustments serialize at PostgreSQL; a failed predicate cannot oversell or overflow INT.
      const changed = await tx.$queryRaw<Array<{ quantity: number; quantityBefore: number }>>`
        UPDATE "stocks"
        SET "quantity" = "quantity" + ${dto.quantityChange},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "productId" = ${productId}
          AND "quantity" >= "reservedQuantity"
          AND (
            (${dto.quantityChange} > 0 AND "quantity" <= ${maxQuantityBeforeIncrease})
            OR (
              ${dto.quantityChange} < 0
              AND "quantity" - "reservedQuantity" >= ${-dto.quantityChange}
            )
          )
        RETURNING "quantity", ("quantity" - ${dto.quantityChange}) AS "quantityBefore"
      `;
      const result = changed[0];
      if (!result) {
        throw new ConflictException('Stock adjustment would make the quantity invalid.');
      }

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          userId: actorId,
          type: dto.reason,
          quantity: dto.quantityChange,
          quantityBefore: result.quantityBefore,
          quantityAfter: result.quantity,
          note: dto.note?.trim() || null,
        },
      });
      return { stock: { productId, quantity: result.quantity }, movement };
    });
  }

  async getStock(productId: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true },
      select: {
        stock: {
          select: {
            productId: true,
            quantity: true,
            reservedQuantity: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    const stock = product.stock;
    if (!stock) throw new NotFoundException('Stock has not been initialized for this product.');
    return { productId: stock.productId, quantity: stock.quantity, availableQuantity: stock.quantity - stock.reservedQuantity, updatedAt: stock.updatedAt };
  }

  async getMovements(productId: number, query: QueryStockMovementsDto) {
    if (!(await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
      throw new NotFoundException('Product not found.');
    }
    const where: Prisma.StockMovementWhereInput = { productId };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          productId: true,
          userId: true,
          type: true,
          quantity: true,
          quantityBefore: true,
          quantityAfter: true,
          note: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  private hasCode(error: unknown, code: string) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}

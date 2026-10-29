import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddCartItemDto, MAX_CART_INT } from './dto/add-cart-item.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';

const CART_SELECT = {
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      productId: true,
      quantity: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          isActive: true,
          price: true,
        },
      },
    },
  },
} satisfies Prisma.CartSelect;

type CartItemRow = {
  productId: number;
  quantity: number;
  product: {
    id: number;
    name: string;
    slug: string;
    imageUrl: string | null;
    isActive: boolean;
    price: Prisma.Decimal;
  };
};

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: number) {
    this.validateUserId(userId);
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: CART_SELECT,
    });
    return this.toResponse(cart?.items ?? []);
  }

  async addItem(userId: number, dto: AddCartItemDto) {
    this.validateUserId(userId);
    this.validateInt(dto.productId, 'Product ID');
    this.validateInt(dto.quantity, 'Quantity');

    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: dto.productId },
        select: { id: true, isActive: true },
      });
      if (!product || !product.isActive) {
        throw new UnprocessableEntityException('Product is unavailable.');
      }

      // Cart.userId is unique. Let PostgreSQL resolve concurrent first-adds
      // against that constraint, avoiding an application read-then-create race.
      const carts = await tx.$queryRaw<Array<{ id: number }>>`
        INSERT INTO "Cart" ("userId", "createdAt", "updatedAt")
        VALUES (${userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("userId") DO UPDATE
        SET "updatedAt" = "Cart"."updatedAt"
        RETURNING "id"
      `;
      const cart = carts[0];
      if (!cart) throw new ConflictException('Cart could not be created.');

      // Use PostgreSQL's unique-key UPSERT so increments are atomic. The WHERE
      // clause prevents integer overflow before the addition is evaluated.
      const rows = await tx.$queryRaw<Array<{ id: number }>>`
        INSERT INTO "CartItem" ("cartId", "productId", "quantity", "createdAt", "updatedAt")
        VALUES (${cart.id}, ${dto.productId}, ${dto.quantity}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("cartId", "productId") DO UPDATE
        SET "quantity" = "CartItem"."quantity" + EXCLUDED."quantity",
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "CartItem"."quantity" <= ${MAX_CART_INT} - EXCLUDED."quantity"
        RETURNING "id"
      `;
      if (rows.length === 0) {
        throw new ConflictException('Cart item quantity exceeds the supported maximum.');
      }
    });

    return this.getCart(userId);
  }

  async updateItem(userId: number, productId: number, dto: UpdateCartItemDto) {
    this.validateUserId(userId);
    this.validateInt(productId, 'Product ID');
    this.validateInt(dto.quantity, 'Quantity');
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!cart) throw new NotFoundException('Cart item not found.');
    const result = await this.prisma.cartItem.updateMany({
      where: { cartId: cart.id, productId },
      data: { quantity: dto.quantity },
    });
    if (result.count === 0) throw new NotFoundException('Cart item not found.');
    return this.getCart(userId);
  }

  async removeItem(userId: number, productId: number) {
    this.validateUserId(userId);
    this.validateInt(productId, 'Product ID');
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!cart) throw new NotFoundException('Cart item not found.');
    const result = await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id, productId },
    });
    if (result.count === 0) throw new NotFoundException('Cart item not found.');
    return this.getCart(userId);
  }

  async clearCart(userId: number) {
    this.validateUserId(userId);
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (cart) await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return { items: [], subtotal: new Prisma.Decimal(0) };
  }

  private toResponse(items: CartItemRow[]) {
    let subtotal = new Prisma.Decimal(0);
    const responseItems = items.map((item) => {
      const lineSubtotal = item.product.price.mul(item.quantity);
      subtotal = subtotal.add(lineSubtotal);
      return {
        productId: item.productId,
        name: item.product.name,
        slug: item.product.slug,
        imageUrl: item.product.imageUrl,
        isActive: item.product.isActive,
        quantity: item.quantity,
        currentUnitPrice: item.product.price,
        lineSubtotal,
      };
    });
    return { items: responseItems, subtotal };
  }

  private validateUserId(userId: number) {
    if (!Number.isInteger(userId) || userId < 1 || userId > MAX_CART_INT) {
      throw new BadRequestException('Invalid authenticated user.');
    }
  }

  private validateInt(value: number, label: string) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_CART_INT) {
      throw new BadRequestException(`${label} must be a positive 32-bit integer.`);
    }
  }
}

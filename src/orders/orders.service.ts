import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from '../stock/stock.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { CheckoutOrderDto } from './dto/checkout-order.dto.js';
import { QueryAdminOrdersDto, QueryOrdersDto } from './dto/query-orders.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';

const MAX_INT = 2_147_483_647;
const MAX_ORDER_TOTAL = new Prisma.Decimal('9999999999.99');

const orderDetailSelect = {
  id: true,
  orderNumber: true,
  userId: true,
  totalAmount: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  shippingName: true,
  shippingPhone: true,
  shippingAddress: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      unitPrice: true,
      quantity: true,
      subtotal: true,
    },
  },
} satisfies Prisma.OrderSelect;

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

type OrderLine = { productId: number; quantity: number };
type OrderShipping = Pick<
  CreateOrderDto | CheckoutOrderDto,
  'shippingName' | 'shippingPhone' | 'shippingAddress' | 'note' | 'paymentMethod'
>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async create(userId: number, dto: CreateOrderDto) {
    this.validatePaymentMethod(dto.paymentMethod);
    const requested = dto.items ?? [];
    this.validateOrderLines(requested);

    return this.prisma.$transaction(async (tx) => {
      return this.createOrderInTransaction(tx, userId, requested, dto);
    });
  }

  async checkout(userId: number, dto: CheckoutOrderDto) {
    this.validatePaymentMethod(dto.paymentMethod);
    return this.prisma.$transaction(async (tx) => {
      // Serialize checkout and Cart writes for this owner. The next statement
      // reads CartItems after any preceding checkout has committed.
      const carts = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE
      `;
      const cart = carts[0];
      if (!cart) throw new BadRequestException('Cart is empty.');

      const cartItems = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        select: { productId: true, quantity: true },
        orderBy: { productId: 'asc' },
      });
      if (cartItems.length === 0) {
        throw new BadRequestException('Cart is empty.');
      }

      this.validateOrderLines(cartItems);
      const order = await this.createOrderInTransaction(
        tx,
        userId,
        cartItems,
        dto,
      );

      // Keep the Cart intact unless the Order and every stock movement succeed.
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return order;
    });
  }

  private validatePaymentMethod(method?: PaymentMethod) {
    if (method !== undefined && method !== PaymentMethod.COD && method !== PaymentMethod.MANUAL) {
      throw new BadRequestException('Unsupported payment method.');
    }
  }

  private validateOrderLines(requested: OrderLine[]) {
    if (requested.length < 1 || requested.length > 50) {
      throw new BadRequestException(
        'An order must contain between 1 and 50 items.',
      );
    }
    if (
      requested.some(
        (item) =>
          !Number.isInteger(item.productId) ||
          item.productId < 1 ||
          item.productId > MAX_INT ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > MAX_INT,
      )
    ) {
      throw new BadRequestException(
        'Each item must have a valid product ID and positive integer quantity.',
      );
    }
    const productIds = requested.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'An order cannot contain duplicate product IDs.',
      );
    }
  }

  private async createOrderInTransaction(
    tx: Prisma.TransactionClient,
    userId: number,
    requested: OrderLine[],
    dto: OrderShipping,
  ) {
    this.validateOrderLines(requested);
    const productIds = requested.map((item) => item.productId);
    // Pricing policy: snapshot the active catalogue name and price read inside
    // this transaction; the persisted OrderItem snapshot remains authoritative.
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, name: true, price: true },
    });
    if (products.length !== productIds.length) {
      throw new UnprocessableEntityException(
        'One or more products are unavailable.',
      );
    }
    const productById = new Map(products.map((product) => [product.id, product]));
    const itemSnapshots = requested.map((item) => {
      const product = productById.get(item.productId)!;
      const unitPrice = new Prisma.Decimal(product.price.toString());
      const subtotal = unitPrice.mul(item.quantity);
      if (subtotal.gt(MAX_ORDER_TOTAL)) {
        throw new UnprocessableEntityException(
          'An item subtotal exceeds the supported order amount.',
        );
      }
      return {
        productId: product.id,
        productName: product.name,
        unitPrice,
        quantity: item.quantity,
        subtotal,
      };
    });
    const totalAmount = itemSnapshots.reduce(
      (total, item) => total.plus(item.subtotal),
      new Prisma.Decimal(0),
    );
    if (totalAmount.gt(MAX_ORDER_TOTAL)) {
      throw new UnprocessableEntityException(
        'The order total exceeds the supported amount.',
      );
    }

    const order = await tx.order.create({
      data: {
        orderNumber: `ORD-${randomUUID()}`,
        userId,
        totalAmount,
        status: OrderStatus.PENDING,
        paymentMethod: dto.paymentMethod ?? PaymentMethod.COD,
        paymentStatus: PaymentStatus.PENDING,
        shippingName: dto.shippingName.trim(),
        shippingPhone: dto.shippingPhone.trim(),
        shippingAddress: dto.shippingAddress.trim(),
        note: dto.note?.trim() || null,
        items: { create: itemSnapshots },
      },
      select: { id: true },
    });

    // Stable order prevents avoidable deadlocks when concurrent orders share products.
    for (const item of [...requested].sort(
      (left, right) => left.productId - right.productId,
    )) {
      await this.stock.consumeForOrder(
        tx,
        item.productId,
        item.quantity,
        userId,
        order.id,
      );
    }

    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: orderDetailSelect,
    });
  }

  async listMine(userId: number, query: QueryOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = { userId };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: orderDetailSelect,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findMine(userId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: orderDetailSelect,
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  async listAll(query: QueryAdminOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      ...(query.status !== undefined && { status: query.status }),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: orderDetailSelect,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: orderDetailSelect,
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  async cancelMine(userId: number, orderId: number) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.status !== OrderStatus.PENDING) {
        throw new ConflictException(
          'Customers may cancel only pending orders.',
        );
      }
      if (order.paymentStatus === PaymentStatus.PAID) {
        throw new ConflictException('Paid orders cannot be cancelled without refund support.');
      }
      await this.cancelAndRestore(tx, order, userId, {
        userId,
        status: OrderStatus.PENDING,
        paymentStatus: { not: PaymentStatus.PAID },
      });
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: orderDetailSelect,
      });
    });
  }

  async updateStatus(
    orderId: number,
    dto: UpdateOrderStatusDto,
    actorId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found.');
      if (!allowedTransitions[order.status].includes(dto.status)) {
        throw new ConflictException(
          `Cannot transition an order from ${order.status} to ${dto.status}.`,
        );
      }

      if (dto.status === OrderStatus.CANCELLED && order.paymentStatus === PaymentStatus.PAID) {
        throw new ConflictException('Paid orders cannot be cancelled without refund support.');
      }

      if (dto.status === OrderStatus.CANCELLED) {
        await this.cancelAndRestore(tx, order, actorId, {
          status: order.status,
          paymentStatus: { not: PaymentStatus.PAID },
        });
      } else {
        const updated = await tx.order.updateMany({
          where: { id: orderId, status: order.status },
          data: { status: dto.status },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'The order status changed concurrently. Reload and retry.',
          );
        }
      }

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: orderDetailSelect,
      });
    });
  }

  private async cancelAndRestore(
    tx: Prisma.TransactionClient,
    order: {
      id: number;
      status: OrderStatus;
      items: Array<{ productId: number; quantity: number }>;
    },
    actorId: number,
    ownerFilter: { userId?: number; status: OrderStatus; paymentStatus?: { not: PaymentStatus } },
  ) {
    const updated = await tx.order.updateMany({
      where: { id: order.id, ...ownerFilter },
      data: { status: OrderStatus.CANCELLED },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'The order status changed concurrently. Reload and retry.',
      );
    }
    const items = [...order.items].sort(
      (left, right) => left.productId - right.productId,
    );
    for (const item of items) {
      await this.stock.restoreForOrder(
        tx,
        item.productId,
        item.quantity,
        actorId,
        order.id,
      );
    }
  }
}

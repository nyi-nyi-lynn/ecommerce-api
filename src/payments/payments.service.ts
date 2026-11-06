import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../generated/prisma/client.js';
import {
  buildPaginatedResponse,
  resolvePaginationParams,
} from '../common/pagination/pagination.util.js';
import { UploadsService } from '../modules/uploads/uploads.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryPaymentsDto } from './dto/query-payments.dto.js';
import { RejectPaymentDto } from './dto/reject-payment.dto.js';
import { SubmitManualPaymentDto } from './dto/submit-manual-payment.dto.js';

const attemptSelect = {
  id: true,
  orderId: true,
  method: true,
  providerCode: true,
  status: true,
  amount: true,
  currency: true,
  transactionReference: true,
  proofUrl: true,
  imagePublicId: true,
  rejectionReason: true,
  submittedAt: true,
  reviewedAt: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      totalAmount: true,
      userId: true,
      user: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PaymentAttemptSelect;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly uploads?: UploadsService,
  ) {}

  async getCustomerOrderPayments(userId: string, orderId: string) {
    this.validateId(orderId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        orderNumber: true,
        paymentMethod: true,
        paymentStatus: true,
        totalAmount: true,
        paymentAttempts: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            method: true,
            providerCode: true,
            status: true,
            amount: true,
            currency: true,
            transactionReference: true,
            proofUrl: true,
            imagePublicId: true,
            rejectionReason: true,
            submittedAt: true,
            reviewedAt: true,
            paidAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  async submitManualPayment(
    userId: string,
    orderId: string,
    dto: SubmitManualPaymentDto,
    image?: Express.Multer.File,
  ) {
    this.validateId(orderId);
    await this.ensureOrderEligibleForManualPayment(
      this.prisma,
      orderId,
      userId,
    );
    if (!image) {
      throw new BadRequestException('Payment proof image file is required.');
    }
    if (!this.uploads) {
      throw new ServiceUnavailableException(
        'Payment proof image uploads are unavailable.',
      );
    }

    const uploaded = await this.uploads.uploadPaymentProofImage(image, userId);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.lockOrder(tx, orderId, userId);
          const order = await this.ensureOrderEligibleForManualPayment(
            tx,
            orderId,
            userId,
          );

          const attempt = await tx.paymentAttempt.create({
            data: {
              orderId,
              method: PaymentMethod.MANUAL,
              providerCode: dto.providerCode,
              status: PaymentStatus.UNDER_REVIEW,
              amount: order.totalAmount,
              currency: 'MMK',
              transactionReference: dto.transactionReference.trim(),
              proofUrl: uploaded.secure_url,
              imagePublicId: uploaded.public_id,
              submittedAt: new Date(),
            },
            select: {
              id: true,
              orderId: true,
              method: true,
              providerCode: true,
              status: true,
              amount: true,
              currency: true,
              transactionReference: true,
              proofUrl: true,
              imagePublicId: true,
              submittedAt: true,
              createdAt: true,
            },
          });
          await tx.paymentEvent.create({
            data: {
              paymentAttemptId: attempt.id,
              eventType: 'MANUAL_SUBMITTED',
              previousStatus: null,
              newStatus: PaymentStatus.UNDER_REVIEW,
              actorId: userId,
            },
          });
          return attempt;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      const cleanupSucceeded = await this.uploads
        .deletePaymentProofImage(uploaded.public_id)
        .catch(() => false);
      if (cleanupSucceeded === false) {
        this.logger.error(
          `Cloudinary payment proof image cleanup failed for order ${orderId} and public ID ${uploaded.public_id}.`,
        );
      }
      throw error;
    }
  }

  async listAttempts(query: QueryPaymentsDto) {
    const { page, limit, skip } = resolvePaginationParams(query);
    const where: Prisma.PaymentAttemptWhereInput = query.status
      ? { status: query.status }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.paymentAttempt.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          ...attemptSelect,
          reviewedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.paymentAttempt.count({ where }),
    ]);
    return buildPaginatedResponse(items, total, page, limit);
  }

  async getAttempt(attemptId: string) {
    this.validateId(attemptId);
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      select: {
        ...attemptSelect,
        proofUrl: true,
        reviewedBy: { select: { id: true, name: true } },
        events: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            eventType: true,
            previousStatus: true,
            newStatus: true,
            actorId: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Payment attempt not found.');
    return attempt;
  }

  async approveManualPayment(attemptId: string, actorId: string) {
    this.validateId(attemptId);
    return this.prisma.$transaction(
      async (tx) => {
        const initial = await tx.paymentAttempt.findUnique({
          where: { id: attemptId },
          select: { orderId: true },
        });
        if (!initial) throw new NotFoundException('Payment attempt not found.');
        await this.lockOrder(tx, initial.orderId);
        const attempt = await tx.paymentAttempt.findUnique({
          where: { id: attemptId },
          select: { id: true, orderId: true, method: true, status: true },
        });
        if (!attempt) throw new NotFoundException('Payment attempt not found.');
        if (
          attempt.method !== PaymentMethod.MANUAL ||
          attempt.status !== PaymentStatus.UNDER_REVIEW
        ) {
          throw new ConflictException(
            'Only manual payments under review can be approved.',
          );
        }
        const order = await tx.order.findUnique({
          where: { id: attempt.orderId },
          select: { status: true, paymentMethod: true, paymentStatus: true },
        });
        if (!order) throw new NotFoundException('Order not found.');
        if (order.paymentMethod !== PaymentMethod.MANUAL) {
          throw new ConflictException(
            'The payment attempt does not match the order payment method.',
          );
        }
        if (
          order.status === OrderStatus.CANCELLED ||
          order.paymentStatus === PaymentStatus.PAID
        ) {
          throw new ConflictException(
            'The order is not eligible for payment approval.',
          );
        }
        const now = new Date();
        const updatedAttempt = await tx.paymentAttempt.updateMany({
          where: {
            id: attemptId,
            status: PaymentStatus.UNDER_REVIEW,
            method: PaymentMethod.MANUAL,
          },
          data: {
            status: PaymentStatus.PAID,
            reviewedAt: now,
            paidAt: now,
            reviewedById: actorId,
          },
        });
        if (updatedAttempt.count !== 1)
          throw new ConflictException(
            'The payment attempt changed concurrently.',
          );
        const updatedOrder = await tx.order.updateMany({
          where: {
            id: attempt.orderId,
            paymentStatus: { not: PaymentStatus.PAID },
            status: { not: OrderStatus.CANCELLED },
          },
          data: { paymentStatus: PaymentStatus.PAID },
        });
        if (updatedOrder.count !== 1)
          throw new ConflictException(
            'The order payment status changed concurrently.',
          );
        await tx.paymentEvent.create({
          data: {
            paymentAttemptId: attemptId,
            eventType: 'MANUAL_APPROVED',
            previousStatus: PaymentStatus.UNDER_REVIEW,
            newStatus: PaymentStatus.PAID,
            actorId,
          },
        });
        return tx.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: attemptSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async rejectManualPayment(
    attemptId: string,
    actorId: string,
    dto: RejectPaymentDto,
  ) {
    this.validateId(attemptId);
    return this.prisma.$transaction(
      async (tx) => {
        const initial = await tx.paymentAttempt.findUnique({
          where: { id: attemptId },
          select: { orderId: true },
        });
        if (!initial) throw new NotFoundException('Payment attempt not found.');
        await this.lockOrder(tx, initial.orderId);
        const attempt = await tx.paymentAttempt.findUnique({
          where: { id: attemptId },
          select: { id: true, orderId: true, method: true, status: true },
        });
        if (!attempt) throw new NotFoundException('Payment attempt not found.');
        if (
          attempt.method !== PaymentMethod.MANUAL ||
          attempt.status !== PaymentStatus.UNDER_REVIEW
        ) {
          throw new ConflictException(
            'Only manual payments under review can be rejected.',
          );
        }
        const now = new Date();
        const updated = await tx.paymentAttempt.updateMany({
          where: {
            id: attemptId,
            status: PaymentStatus.UNDER_REVIEW,
            method: PaymentMethod.MANUAL,
          },
          data: {
            status: PaymentStatus.REJECTED,
            rejectionReason: dto.reason.trim(),
            reviewedAt: now,
            reviewedById: actorId,
          },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            'The payment attempt changed concurrently.',
          );
        await tx.paymentEvent.create({
          data: {
            paymentAttemptId: attemptId,
            eventType: 'MANUAL_REJECTED',
            previousStatus: PaymentStatus.UNDER_REVIEW,
            newStatus: PaymentStatus.REJECTED,
            actorId,
            reason: dto.reason.trim(),
          },
        });
        return tx.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: attemptSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async collectCod(orderId: string, actorId: string) {
    this.validateId(orderId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockOrder(tx, orderId);
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            totalAmount: true,
            status: true,
            paymentMethod: true,
            paymentStatus: true,
          },
        });
        if (!order) throw new NotFoundException('Order not found.');
        if (order.paymentMethod !== PaymentMethod.COD)
          throw new ConflictException('This order does not use COD.');
        if (order.status !== OrderStatus.DELIVERED)
          throw new ConflictException(
            'COD can be collected only for delivered orders.',
          );
        if (order.paymentStatus === PaymentStatus.PAID)
          throw new ConflictException('This order is already paid.');
        const now = new Date();
        const updated = await tx.order.updateMany({
          where: {
            id: orderId,
            status: OrderStatus.DELIVERED,
            paymentMethod: PaymentMethod.COD,
            paymentStatus: { not: PaymentStatus.PAID },
          },
          data: { paymentStatus: PaymentStatus.PAID },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            'The order payment status changed concurrently.',
          );
        const attempt = await tx.paymentAttempt.create({
          data: {
            orderId,
            method: PaymentMethod.COD,
            providerCode: null,
            status: PaymentStatus.PAID,
            amount: order.totalAmount,
            currency: 'MMK',
            reviewedAt: now,
            paidAt: now,
            reviewedById: actorId,
          },
          select: { id: true },
        });
        await tx.paymentEvent.create({
          data: {
            paymentAttemptId: attempt.id,
            eventType: 'COD_COLLECTED',
            previousStatus: null,
            newStatus: PaymentStatus.PAID,
            actorId,
          },
        });
        return tx.paymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
          select: attemptSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async lockOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    userId?: string,
  ) {
    // READ COMMITTED gives each query after FOR UPDATE a fresh snapshot, so a
    // waiter can observe the payment state committed by the transaction ahead.
    const rows =
      userId === undefined
        ? await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
        : await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('Order not found.');
  }

  private async ensureOrderEligibleForManualPayment(
    client: Pick<Prisma.TransactionClient, 'order' | 'paymentAttempt'>,
    orderId: string,
    userId: string,
  ) {
    const order = await client.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.paymentMethod !== PaymentMethod.MANUAL) {
      throw new ConflictException('This order does not use manual payment.');
    }
    if (
      order.status === OrderStatus.CANCELLED ||
      order.paymentStatus === PaymentStatus.PAID
    ) {
      throw new ConflictException(
        'This order is not eligible for a payment attempt.',
      );
    }
    const existing = await client.paymentAttempt.findFirst({
      where: {
        orderId,
        status: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.UNDER_REVIEW,
            PaymentStatus.PAID,
          ],
        },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictException(
        'A payment attempt is already active or paid.',
      );
    }
    return order;
  }

  private validateId(id: string) {
    if (typeof id !== 'string' || !isUUID(id))
      throw new BadRequestException('A valid ID is required.');
  }
}

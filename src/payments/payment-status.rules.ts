import {
  OrderPaymentStatus,
  PaymentStatus,
} from '../generated/prisma/client.js';

export { OrderPaymentStatus };

/**
 * Single source of truth for payment-state rules.
 *
 * Dedicated enums:
 * - `PaymentAttempt.status` (`PaymentStatus`):
 *   PENDING → UNDER_REVIEW → PAID | REJECTED | FAILED | CANCELLED.
 *   Authoritative for the lifecycle of an individual payment attempt.
 *   Settled attempts are historical and are never rewritten.
 *
 * - `Order.paymentStatus` (`OrderPaymentStatus`):
 *   PENDING | PAID | CANCELLED.
 *   Authoritative for the order settlement lifecycle.
 *   PaymentAttempt-specific statuses like UNDER_REVIEW / REJECTED / FAILED
 *   cannot exist on Order.
 */
export const ORDER_PAYMENT_STATUS = {
  UNPAID: OrderPaymentStatus.PENDING,
  PAID: OrderPaymentStatus.PAID,
  CANCELLED: OrderPaymentStatus.CANCELLED,
} as const satisfies Record<string, OrderPaymentStatus>;

/** Attempts that are still open and are cancelled together with their Order. */
export const OPEN_ATTEMPT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.UNDER_REVIEW,
];

/** Attempts that block a new submission (open, or already settled as paid). */
export const BLOCKING_ATTEMPT_STATUSES: readonly PaymentStatus[] = [
  ...OPEN_ATTEMPT_STATUSES,
  PaymentStatus.PAID,
];

export const isOpenAttemptStatus = (status: PaymentStatus) =>
  OPEN_ATTEMPT_STATUSES.includes(status);

/** Order-level payment status after an order is cancelled. */
export function orderPaymentStatusAfterCancel(
  current: OrderPaymentStatus,
): OrderPaymentStatus {
  return current === ORDER_PAYMENT_STATUS.UNPAID
    ? ORDER_PAYMENT_STATUS.CANCELLED
    : current;
}



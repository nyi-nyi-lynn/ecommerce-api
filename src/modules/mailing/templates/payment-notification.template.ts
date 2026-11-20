import type {
  PaymentNotificationPayload,
  RenderedEmail,
} from '../mailing.interface.js';
import { escapeHtml, renderEmailLayout } from './template.util.js';

function resolveHeadingAndIntro(payload: PaymentNotificationPayload): {
  subject: string;
  heading: string;
  intro: string;
} {
  switch (payload.kind) {
    case 'MANUAL_SUBMITTED':
      return {
        subject: `Payment Proof Received for Order ${payload.orderNumber}`,
        heading: 'Payment Proof Submitted',
        intro: `We have received your manual payment proof for order ${payload.orderNumber}. Our team will review it shortly.`,
      };
    case 'MANUAL_APPROVED':
      return {
        subject: `Payment Approved for Order ${payload.orderNumber}`,
        heading: 'Payment Approved',
        intro: `Your manual payment for order ${payload.orderNumber} has been approved and marked as paid.`,
      };
    case 'MANUAL_REJECTED':
      return {
        subject: `Payment Proof Rejected for Order ${payload.orderNumber}`,
        heading: 'Payment Proof Rejected',
        intro: `Your manual payment proof for order ${payload.orderNumber} could not be approved. Please review the reason below and submit a new proof if needed.`,
      };
    case 'COD_COLLECTED':
      return {
        subject: `Cash on Delivery Payment Recorded for Order ${payload.orderNumber}`,
        heading: 'COD Payment Collected',
        intro: `Your cash-on-delivery payment for order ${payload.orderNumber} has been collected and recorded.`,
      };
    default:
      return {
        subject: `Payment Status Updated for Order ${payload.orderNumber}`,
        heading: 'Payment Status Update',
        intro: `The payment status for order ${payload.orderNumber} has been updated to ${payload.paymentStatus}.`,
      };
  }
}

export function renderPaymentNotificationTemplate(
  payload: PaymentNotificationPayload,
  brandName?: string,
): RenderedEmail {
  const { subject, heading, intro } = resolveHeadingAndIntro(payload);
  const safeName = escapeHtml(payload.recipientName);
  const safeIntro = escapeHtml(intro);

  const optionalDetailsHtml = [
    payload.providerCode
      ? `<p style="margin:6px 0;font-size:14px;"><strong>Provider:</strong> ${escapeHtml(payload.providerCode)}</p>`
      : '',
    payload.transactionReference
      ? `<p style="margin:6px 0;font-size:14px;"><strong>Transaction Reference:</strong> ${escapeHtml(payload.transactionReference)}</p>`
      : '',
    payload.rejectionReason
      ? `<p style="margin:6px 0;font-size:14px;color:#b91c1c;"><strong>Reason:</strong> ${escapeHtml(payload.rejectionReason)}</p>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const orderLinkHtml = payload.orderUrl
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(payload.orderUrl)}" style="display:inline-block;padding:10px 18px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">View Order</a></p>`
    : '';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 16px;">Hello ${safeName},</p>
    <p style="margin:0 0 16px;">${safeIntro}</p>
    <p style="margin:6px 0;font-size:14px;"><strong>Status:</strong> ${escapeHtml(payload.paymentStatus)}</p>
    <p style="margin:6px 0;font-size:14px;"><strong>Method:</strong> ${escapeHtml(payload.paymentMethod)}</p>
    <p style="margin:6px 0;font-size:14px;"><strong>Amount:</strong> ${escapeHtml(payload.amount)} ${escapeHtml(payload.currency)}</p>
    ${optionalDetailsHtml}
    ${orderLinkHtml}
  `;

  const text = [
    `Hello ${payload.recipientName},`,
    '',
    intro,
    '',
    `Status: ${payload.paymentStatus}`,
    `Method: ${payload.paymentMethod}`,
    `Amount: ${payload.amount} ${payload.currency}`,
    ...(payload.providerCode ? [`Provider: ${payload.providerCode}`] : []),
    ...(payload.transactionReference
      ? [`Transaction Reference: ${payload.transactionReference}`]
      : []),
    ...(payload.rejectionReason
      ? [`Reason: ${payload.rejectionReason}`]
      : []),
    ...(payload.orderUrl ? ['', `View order: ${payload.orderUrl}`] : []),
  ].join('\n');

  return {
    subject,
    html: renderEmailLayout({ title: subject, bodyHtml, brandName }),
    text,
  };
}

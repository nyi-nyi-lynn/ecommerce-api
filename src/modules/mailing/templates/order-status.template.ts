import type {
  OrderStatusPayload,
  RenderedEmail,
} from '../mailing.interface.js';
import { escapeHtml, renderEmailLayout } from './template.util.js';

export function renderOrderStatusTemplate(
  payload: OrderStatusPayload,
  brandName?: string,
): RenderedEmail {
  const subject = `Order ${payload.orderNumber} Status Updated: ${payload.newStatus}`;
  const safeName = escapeHtml(payload.recipientName);
  const safeOrderNumber = escapeHtml(payload.orderNumber);
  const safeNewStatus = escapeHtml(payload.newStatus);
  const safeTotal = escapeHtml(payload.totalAmount);

  const previousHtml = payload.previousStatus
    ? `<p style="margin:6px 0;font-size:14px;"><strong>Previous Status:</strong> ${escapeHtml(payload.previousStatus)}</p>`
    : '';
  const orderLinkHtml = payload.orderUrl
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(payload.orderUrl)}" style="display:inline-block;padding:10px 18px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">View Order</a></p>`
    : '';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">Order Status Update</h1>
    <p style="margin:0 0 16px;">Hello ${safeName},</p>
    <p style="margin:0 0 16px;">The status of your order <strong>${safeOrderNumber}</strong> has been updated.</p>
    ${previousHtml}
    <p style="margin:6px 0;font-size:14px;"><strong>Current Status:</strong> ${safeNewStatus}</p>
    <p style="margin:6px 0;font-size:14px;"><strong>Order Total:</strong> ${safeTotal}</p>
    ${orderLinkHtml}
  `;

  const text = [
    `Hello ${payload.recipientName},`,
    '',
    `The status of your order ${payload.orderNumber} has been updated.`,
    ...(payload.previousStatus
      ? [`Previous Status: ${payload.previousStatus}`]
      : []),
    `Current Status: ${payload.newStatus}`,
    `Order Total: ${payload.totalAmount}`,
    ...(payload.orderUrl ? ['', `View order: ${payload.orderUrl}`] : []),
  ].join('\n');

  return {
    subject,
    html: renderEmailLayout({ title: subject, bodyHtml, brandName }),
    text,
  };
}

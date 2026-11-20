import type {
  OrderConfirmationPayload,
  RenderedEmail,
} from '../mailing.interface.js';
import { escapeHtml, renderEmailLayout } from './template.util.js';

export function renderOrderConfirmationTemplate(
  payload: OrderConfirmationPayload,
  brandName?: string,
): RenderedEmail {
  const subject = `Order Confirmed: ${payload.orderNumber}`;
  const safeName = escapeHtml(payload.recipientName);
  const safeOrderNumber = escapeHtml(payload.orderNumber);
  const safeTotal = escapeHtml(payload.totalAmount);
  const safeMethod = escapeHtml(payload.paymentMethod);
  const safeShippingName = escapeHtml(payload.shippingName);
  const safeShippingPhone = escapeHtml(payload.shippingPhone);
  const safeShippingAddress = escapeHtml(payload.shippingAddress);

  const itemRowsHtml = payload.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.productName)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(item.unitPrice)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(item.subtotal)}</td>
      </tr>`,
    )
    .join('');

  const orderLinkHtml = payload.orderUrl
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(payload.orderUrl)}" style="display:inline-block;padding:10px 18px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">View Order</a></p>`
    : '';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">Thank you for your order!</h1>
    <p style="margin:0 0 16px;">Hello ${safeName},</p>
    <p style="margin:0 0 16px;">We have received your order <strong>${safeOrderNumber}</strong>.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
      <thead>
        <tr style="background-color:#f9fafb;">
          <th style="padding:8px;text-align:left;border-bottom:1px solid #d1d5db;">Item</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid #d1d5db;">Qty</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #d1d5db;">Price</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #d1d5db;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${itemRowsHtml}</tbody>
    </table>
    <p style="margin:12px 0;font-size:15px;"><strong>Total:</strong> ${safeTotal}</p>
    <p style="margin:6px 0;font-size:14px;"><strong>Payment Method:</strong> ${safeMethod}</p>
    <p style="margin:6px 0;font-size:14px;"><strong>Shipping To:</strong> ${safeShippingName}, ${safeShippingPhone}, ${safeShippingAddress}</p>
    ${orderLinkHtml}
  `;

  const itemLinesText = payload.items.map(
    (item) =>
      `- ${item.productName} x${item.quantity} @ ${item.unitPrice} = ${item.subtotal}`,
  );

  const text = [
    `Hello ${payload.recipientName},`,
    '',
    `Thank you for your order (${payload.orderNumber}).`,
    '',
    'Items:',
    ...itemLinesText,
    '',
    `Total: ${payload.totalAmount}`,
    `Payment Method: ${payload.paymentMethod}`,
    `Shipping To: ${payload.shippingName}, ${payload.shippingPhone}, ${payload.shippingAddress}`,
    ...(payload.orderUrl ? ['', `View order: ${payload.orderUrl}`] : []),
  ].join('\n');

  return {
    subject,
    html: renderEmailLayout({ title: subject, bodyHtml, brandName }),
    text,
  };
}

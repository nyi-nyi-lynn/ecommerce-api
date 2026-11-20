import type {
  RenderedEmail,
  WelcomeEmailPayload,
} from '../mailing.interface.js';
import { escapeHtml, renderEmailLayout } from './template.util.js';

export function renderWelcomeEmailTemplate(
  payload: WelcomeEmailPayload,
  brandName?: string,
): RenderedEmail {
  const safeName = escapeHtml(payload.recipientName);
  const safeUrl = escapeHtml(payload.frontendUrl);
  const storeName = brandName ?? 'E-commerce Store';
  const subject = `Welcome to ${storeName}`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">Welcome, ${safeName}!</h1>
    <p style="margin:0 0 16px;">Your account has been created successfully. You can now browse products, manage your cart, and track your orders.</p>
    <p style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Visit Store</a>
    </p>
  `;

  const text = [
    `Welcome, ${payload.recipientName}!`,
    '',
    `Your account at ${storeName} has been created successfully.`,
    `Visit the store: ${payload.frontendUrl}`,
  ].join('\n');

  return {
    subject,
    html: renderEmailLayout({ title: subject, bodyHtml, brandName }),
    text,
  };
}

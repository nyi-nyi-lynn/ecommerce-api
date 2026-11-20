import type {
  EmailVerificationPayload,
  RenderedEmail,
} from '../mailing.interface.js';
import { escapeHtml, renderEmailLayout } from './template.util.js';

function formatDuration(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function renderEmailVerificationTemplate(
  payload: EmailVerificationPayload,
  brandName?: string,
): RenderedEmail {
  const safeName = escapeHtml(payload.recipientName);
  const safeUrl = escapeHtml(payload.verificationUrl);
  const duration = formatDuration(payload.expiresInMinutes);
  const subject = 'Verify your email address';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">Verify your email address</h1>
    <p style="margin:0 0 16px;">Hello ${safeName},</p>
    <p style="margin:0 0 16px;">Please confirm your email address by clicking the button below. This verification link will expire in <strong>${escapeHtml(duration)}</strong>.</p>
    <p style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Verify Email</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">If the button does not work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 16px;font-size:13px;word-break:break-all;color:#2563eb;">${safeUrl}</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">If you did not create an account, you can safely ignore this email.</p>
  `;

  const text = [
    `Hello ${payload.recipientName},`,
    '',
    'Please verify your email address using the link below:',
    payload.verificationUrl,
    '',
    `This link expires in ${duration}.`,
    'If you did not create an account, you can safely ignore this email.',
  ].join('\n');

  return {
    subject,
    html: renderEmailLayout({ title: subject, bodyHtml, brandName }),
    text,
  };
}

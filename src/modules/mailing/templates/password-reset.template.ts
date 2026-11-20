import type {
  PasswordResetPayload,
  RenderedEmail,
} from '../mailing.interface.js';
import { escapeHtml, renderEmailLayout } from './template.util.js';

export function renderPasswordResetTemplate(
  payload: PasswordResetPayload,
  brandName?: string,
): RenderedEmail {
  const safeName = escapeHtml(payload.recipientName);
  const safeUrl = escapeHtml(payload.resetUrl);
  const duration =
    payload.expiresInMinutes === 1
      ? '1 minute'
      : `${payload.expiresInMinutes} minutes`;
  const subject = 'Reset your password';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">Reset your password</h1>
    <p style="margin:0 0 16px;">Hello ${safeName},</p>
    <p style="margin:0 0 16px;">We received a request to reset the password for your account. Click the button below to choose a new password. This link will expire in <strong>${escapeHtml(duration)}</strong>.</p>
    <p style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Reset Password</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">If the button does not work, copy and paste this link into your browser:</p>
    <p style="margin:0 0 16px;font-size:13px;word-break:break-all;color:#2563eb;">${safeUrl}</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">If you did not request a password reset, no action is needed and your password will remain unchanged.</p>
  `;

  const text = [
    `Hello ${payload.recipientName},`,
    '',
    'We received a request to reset your password. Use the link below to set a new password:',
    payload.resetUrl,
    '',
    `This link expires in ${duration}.`,
    'If you did not request a password reset, you can safely ignore this email.',
  ].join('\n');

  return {
    subject,
    html: renderEmailLayout({ title: subject, bodyHtml, brandName }),
    text,
  };
}

import type { ConfigService } from '@nestjs/config';
import {
  DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES,
  DEFAULT_FRONTEND_URL,
  DEFAULT_MAIL_FROM_NAME,
  DEFAULT_PASSWORD_RESET_TTL_MINUTES,
} from './mailing.constants.js';
import type { MailingConfig } from './mailing.interface.js';

const MAX_VERIFICATION_TTL_MINUTES = 7 * 24 * 60; // 7 days
const MIN_PASSWORD_RESET_TTL_MINUTES = 5;
const MAX_PASSWORD_RESET_TTL_MINUTES = 120;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(
  value: unknown,
  defaultValue: number,
  name: string,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return num;
}

function normalizeFrontendUrl(raw: unknown): string {
  const value = trimString(raw) ?? DEFAULT_FRONTEND_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('FRONTEND_URL must be a valid http or https URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('FRONTEND_URL must use http or https protocol');
  }
  return value.replace(/\/+$/, '');
}

export function isValidEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > 255) return false;
  if (/[\r\n]/.test(value)) return false;
  return EMAIL_PATTERN.test(value);
}

export function validateMailingEnvironment(env: Record<string, unknown>) {
  const nodeEnv = (trimString(env.NODE_ENV) ?? process.env.NODE_ENV ?? '').toLowerCase();
  const requireCredentials = nodeEnv !== 'test';

  const brevoApiKey = trimString(env.BREVO_API_KEY) ?? '';
  if (requireCredentials && !brevoApiKey) {
    throw new Error(
      'BREVO_API_KEY is required for Brevo transactional email delivery',
    );
  }

  const fromName = trimString(env.MAIL_FROM_NAME) ?? DEFAULT_MAIL_FROM_NAME;
  const fromEmail = trimString(env.MAIL_FROM_EMAIL) ?? '';

  if (requireCredentials && !fromEmail) {
    throw new Error(
      'MAIL_FROM_EMAIL is required and must be a verified sender in Brevo',
    );
  }

  if (fromEmail && !isValidEmailAddress(fromEmail)) {
    throw new Error('MAIL_FROM_EMAIL must be a valid email address');
  }

  const frontendUrl = normalizeFrontendUrl(env.FRONTEND_URL);

  const emailVerificationTtlMinutes = parsePositiveInt(
    env.EMAIL_VERIFICATION_TTL_MINUTES,
    DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES,
    'EMAIL_VERIFICATION_TTL_MINUTES',
    5,
    MAX_VERIFICATION_TTL_MINUTES,
  );

  const passwordResetTtlMinutes = parsePositiveInt(
    env.PASSWORD_RESET_TTL_MINUTES,
    DEFAULT_PASSWORD_RESET_TTL_MINUTES,
    'PASSWORD_RESET_TTL_MINUTES',
    MIN_PASSWORD_RESET_TTL_MINUTES,
    MAX_PASSWORD_RESET_TTL_MINUTES,
  );

  return {
    BREVO_API_KEY: brevoApiKey,
    MAIL_FROM_NAME: fromName,
    MAIL_FROM_EMAIL: fromEmail,
    FRONTEND_URL: frontendUrl,
    EMAIL_VERIFICATION_TTL_MINUTES: emailVerificationTtlMinutes,
    PASSWORD_RESET_TTL_MINUTES: passwordResetTtlMinutes,
  };
}

export function getMailingConfig(config: ConfigService): MailingConfig {
  const brevoApiKey = trimString(config.get<string>('BREVO_API_KEY')) ?? '';
  const fromName =
    trimString(config.get<string>('MAIL_FROM_NAME')) ?? DEFAULT_MAIL_FROM_NAME;
  const fromEmail = trimString(config.get<string>('MAIL_FROM_EMAIL')) ?? '';
  const frontendUrl = normalizeFrontendUrl(config.get<string>('FRONTEND_URL'));

  const emailVerificationTtlMinutes = parsePositiveInt(
    config.get<unknown>('EMAIL_VERIFICATION_TTL_MINUTES'),
    DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES,
    'EMAIL_VERIFICATION_TTL_MINUTES',
    5,
    MAX_VERIFICATION_TTL_MINUTES,
  );

  const passwordResetTtlMinutes = parsePositiveInt(
    config.get<unknown>('PASSWORD_RESET_TTL_MINUTES'),
    DEFAULT_PASSWORD_RESET_TTL_MINUTES,
    'PASSWORD_RESET_TTL_MINUTES',
    MIN_PASSWORD_RESET_TTL_MINUTES,
    MAX_PASSWORD_RESET_TTL_MINUTES,
  );

  return {
    brevoApiKey,
    fromName,
    fromEmail,
    frontendUrl,
    emailVerificationTtlMinutes,
    passwordResetTtlMinutes,
  };
}

export function sanitizeMailingError(
  error: unknown,
  secrets: Array<string | undefined> = [],
): string {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown mailing error';

  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      message = message.replaceAll(secret, '[REDACTED]');
    }
  }

  message = message
    .replace(/xkeysib-[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(
      /\b(api-key|api_key|apikey|Bearer|Authorization|password|pass)\s*[:=]?\s*\S+/gi,
      '$1 [REDACTED]',
    );

  return message;
}

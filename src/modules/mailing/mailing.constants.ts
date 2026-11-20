export const MAILING_PROVIDER = Symbol('MAILING_PROVIDER');
export const MAILING_CONFIG = Symbol('MAILING_CONFIG');

export const BREVO_TRANSACTIONAL_EMAIL_URL =
  'https://api.brevo.com/v3/smtp/email';

export const DEFAULT_MAIL_FROM_NAME = 'My E-commerce Store';
export const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

export const DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES = 24 * 60; // 24 hours
export const DEFAULT_PASSWORD_RESET_TTL_MINUTES = 30; // 30 minutes
export const DEFAULT_MAIL_TIMEOUT_MS = 10_000;

export const MAIL_DEDUP_KEY_PREFIX = 'mail:dedup:';
export const DEFAULT_MAIL_DEDUP_TTL_SECONDS = 24 * 60 * 60; // 24 hours

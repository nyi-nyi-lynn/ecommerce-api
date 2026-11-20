import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DEFAULT_MAIL_DEDUP_TTL_SECONDS,
  MAIL_DEDUP_KEY_PREFIX,
  MAILING_CONFIG,
  MAILING_PROVIDER,
} from './mailing.constants.js';
import { sanitizeMailingError } from './mailing-config.js';
import type {
  EmailVerificationPayload,
  MailingConfig,
  MailMessage,
  MailSendResult,
  OrderConfirmationPayload,
  OrderStatusPayload,
  PaymentNotificationPayload,
  WelcomeEmailPayload,
} from './mailing.interface.js';
import type { MailingProvider } from './providers/mailing-provider.interface.js';
import { renderEmailVerificationTemplate } from './templates/email-verification.template.js';
import { renderOrderConfirmationTemplate } from './templates/order-confirmation.template.js';
import { renderOrderStatusTemplate } from './templates/order-status.template.js';
import { renderPasswordResetTemplate } from './templates/password-reset.template.js';
import { renderPaymentNotificationTemplate } from './templates/payment-notification.template.js';
import { renderWelcomeEmailTemplate } from './templates/welcome-email.template.js';
import { RedisService } from '../../redis/redis.service.js';

@Injectable()
export class MailingService {
  private readonly logger = new Logger(MailingService.name);

  constructor(
    @Inject(MAILING_PROVIDER) private readonly provider: MailingProvider,
    @Inject(MAILING_CONFIG) private readonly config: MailingConfig,
    @Optional() private readonly redis?: RedisService,
  ) {}

  getEmailVerificationTtlMinutes(): number {
    return this.config.emailVerificationTtlMinutes;
  }

  getPasswordResetTtlMinutes(): number {
    return this.config.passwordResetTtlMinutes;
  }

  buildFrontendUrl(
    path: string,
    query?: Record<string, string | undefined>,
  ): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.config.frontendUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  async sendMail(message: MailMessage): Promise<MailSendResult> {
    const prepared: MailMessage = {
      ...message,
      sender: message.sender ?? {
        name: this.config.fromName,
        email: this.config.fromEmail,
      },
    };

    try {
      return await this.provider.send(prepared);
    } catch (error) {
      const sanitized = sanitizeMailingError(error, [this.config.brevoApiKey]);
      const domain = prepared.to.includes('@')
        ? prepared.to.split('@')[1]
        : 'unknown';
      this.logger.error(
        `Email delivery failed via "${this.provider.name}" to *@${domain} (subject: "${prepared.subject}"): ${sanitized}`,
      );
      return {
        sent: false,
        provider: this.provider.name,
        error: sanitized,
      };
    }
  }

  async sendMailIdempotent(
    dedupKey: string,
    message: MailMessage,
    ttlSeconds = DEFAULT_MAIL_DEDUP_TTL_SECONDS,
  ): Promise<MailSendResult> {
    const redisKey = `${MAIL_DEDUP_KEY_PREFIX}${dedupKey}`;
    const claimed = await this.claimDedupKey(redisKey, ttlSeconds);

    if (!claimed) {
      this.logger.debug?.(
        `Skipping duplicate email notification for key "${dedupKey}"`,
      );
      return {
        sent: false,
        skipped: true,
        provider: this.provider.name,
      };
    }

    const result = await this.sendMail(message);
    if (!result.sent) {
      await this.releaseDedupKey(redisKey);
    }
    return result;
  }

  async sendWelcomeEmail(
    to: string,
    payload: Omit<WelcomeEmailPayload, 'frontendUrl'> & {
      frontendUrl?: string;
    },
  ): Promise<MailSendResult> {
    const rendered = renderWelcomeEmailTemplate(
      {
        recipientName: payload.recipientName,
        frontendUrl: payload.frontendUrl ?? this.config.frontendUrl,
      },
      this.config.fromName,
    );
    return this.sendMail({ to, toName: payload.recipientName, ...rendered });
  }

  async sendEmailVerification(
    to: string,
    payload: Omit<EmailVerificationPayload, 'expiresInMinutes'> & {
      expiresInMinutes?: number;
    },
  ): Promise<MailSendResult> {
    const rendered = renderEmailVerificationTemplate(
      {
        recipientName: payload.recipientName,
        verificationUrl: payload.verificationUrl,
        expiresInMinutes:
          payload.expiresInMinutes ?? this.config.emailVerificationTtlMinutes,
      },
      this.config.fromName,
    );
    return this.sendMail({ to, toName: payload.recipientName, ...rendered });
  }

  async sendPasswordReset(
    to: string,
    payload: {
      recipientName: string;
      resetUrl: string;
      expiresInMinutes?: number;
    },
  ): Promise<MailSendResult> {
    const rendered = renderPasswordResetTemplate(
      {
        recipientName: payload.recipientName,
        resetUrl: payload.resetUrl,
        expiresInMinutes:
          payload.expiresInMinutes ?? this.config.passwordResetTtlMinutes,
      },
      this.config.fromName,
    );
    return this.sendMail({ to, toName: payload.recipientName, ...rendered });
  }

  async sendOrderConfirmation(
    to: string,
    payload: OrderConfirmationPayload,
    dedupKey?: string,
  ): Promise<MailSendResult> {
    const rendered = renderOrderConfirmationTemplate(
      payload,
      this.config.fromName,
    );
    const message: MailMessage = {
      to,
      toName: payload.recipientName,
      ...rendered,
    };
    if (dedupKey) {
      return this.sendMailIdempotent(dedupKey, message);
    }
    return this.sendMail(message);
  }

  async sendOrderStatusUpdate(
    to: string,
    payload: OrderStatusPayload,
    dedupKey?: string,
  ): Promise<MailSendResult> {
    const rendered = renderOrderStatusTemplate(payload, this.config.fromName);
    const message: MailMessage = {
      to,
      toName: payload.recipientName,
      ...rendered,
    };
    if (dedupKey) {
      return this.sendMailIdempotent(dedupKey, message);
    }
    return this.sendMail(message);
  }

  async sendPaymentNotification(
    to: string,
    payload: PaymentNotificationPayload,
    dedupKey?: string,
  ): Promise<MailSendResult> {
    const rendered = renderPaymentNotificationTemplate(
      payload,
      this.config.fromName,
    );
    const message: MailMessage = {
      to,
      toName: payload.recipientName,
      ...rendered,
    };
    if (dedupKey) {
      return this.sendMailIdempotent(dedupKey, message);
    }
    return this.sendMail(message);
  }

  private async claimDedupKey(
    redisKey: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.redis) return true;
    try {
      const client = this.redis.getClient();
      if (client.status === 'wait') {
        await this.redis.connect();
      }
      const result = await client.set(redisKey, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      // Fail open so temporary Redis issues do not block transactional emails.
      return true;
    }
  }

  private async releaseDedupKey(redisKey: string): Promise<void> {
    if (!this.redis) return;
    try {
      const client = this.redis.getClient();
      await client.del(redisKey);
    } catch {
      // Best-effort cleanup.
    }
  }
}

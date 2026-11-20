import {
  BREVO_TRANSACTIONAL_EMAIL_URL,
  DEFAULT_MAIL_TIMEOUT_MS,
} from '../mailing.constants.js';
import {
  isValidEmailAddress,
  sanitizeMailingError,
} from '../mailing-config.js';
import type { MailMessage, MailSendResult } from '../mailing.interface.js';
import type { MailingProvider } from './mailing-provider.interface.js';

export interface BrevoProviderOptions {
  apiKey: string;
  apiUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface BrevoErrorResponse {
  code?: string;
  message?: string;
}

interface BrevoSuccessResponse {
  messageId?: unknown;
}

export class BrevoMailingProvider implements MailingProvider {
  readonly name = 'brevo';
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: BrevoProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.apiUrl = options.apiUrl ?? BREVO_TRANSACTIONAL_EMAIL_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MAIL_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    if (!this.apiKey) {
      throw new Error('Brevo API key is not configured.');
    }

    const senderEmail = message.sender?.email?.trim() ?? '';
    const senderName = message.sender?.name?.replace(/[\r\n]/g, '').trim() ?? '';
    if (!senderEmail || !isValidEmailAddress(senderEmail)) {
      throw new Error(
        'A valid verified sender email (MAIL_FROM_EMAIL) is required.',
      );
    }

    const recipientEmail = message.to.trim();
    if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
      throw new Error('A valid recipient email address is required.');
    }

    const payload: Record<string, unknown> = {
      sender: {
        email: senderEmail,
        ...(senderName ? { name: senderName } : {}),
      },
      to: [
        {
          email: recipientEmail,
          ...(message.toName ? { name: message.toName.trim() } : {}),
        },
      ],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    };

    if (message.replyTo && isValidEmailAddress(message.replyTo.trim())) {
      payload.replyTo = { email: message.replyTo.trim() };
    }

    try {
      const response = await this.fetchFn(this.apiUrl, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const rawText = await response.text();
      let parsedBody: unknown;
      if (rawText.trim().length > 0) {
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          if (response.ok) {
            throw new Error(
              'Brevo API returned a malformed non-JSON response.',
            );
          }
          parsedBody = undefined;
        }
      }

      if (!response.ok) {
        const errBody =
          parsedBody && typeof parsedBody === 'object'
            ? (parsedBody as BrevoErrorResponse)
            : undefined;
        const detail = errBody?.message ?? `HTTP ${response.status}`;

        if (response.status === 401 || response.status === 403) {
          throw new Error(
            sanitizeMailingError(
              `Brevo authentication failed (HTTP ${response.status}): ${detail}`,
              [this.apiKey],
            ),
          );
        }

        if (response.status === 400 || response.status === 422) {
          throw new Error(
            sanitizeMailingError(
              `Brevo validation error (HTTP ${response.status}): ${detail}`,
              [this.apiKey],
            ),
          );
        }

        throw new Error(
          sanitizeMailingError(
            `Brevo API error (HTTP ${response.status}): ${detail}`,
            [this.apiKey],
          ),
        );
      }

      const successBody =
        parsedBody && typeof parsedBody === 'object'
          ? (parsedBody as BrevoSuccessResponse)
          : undefined;
      if (
        !successBody ||
        typeof successBody.messageId !== 'string' ||
        successBody.messageId.trim().length === 0
      ) {
        throw new Error(
          'Brevo API returned a malformed response: missing valid messageId.',
        );
      }

      return {
        sent: true,
        provider: this.name,
        messageId: successBody.messageId,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new Error(
          `Brevo API request timed out after ${this.timeoutMs}ms.`,
        );
      }
      throw new Error(sanitizeMailingError(error, [this.apiKey]));
    }
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailingService } from './mailing.service.js';
import type { MailingProvider } from './providers/mailing-provider.interface.js';
import type { MailingConfig } from './mailing.interface.js';
import { BrevoMailingProvider } from './providers/brevo-mailing.provider.js';
import { BREVO_TRANSACTIONAL_EMAIL_URL } from './mailing.constants.js';
import { validateMailingEnvironment } from './mailing-config.js';
import { renderWelcomeEmailTemplate } from './templates/welcome-email.template.js';
import { renderEmailVerificationTemplate } from './templates/email-verification.template.js';
import { renderPasswordResetTemplate } from './templates/password-reset.template.js';
import { renderOrderConfirmationTemplate } from './templates/order-confirmation.template.js';
import { renderOrderStatusTemplate } from './templates/order-status.template.js';
import { renderPaymentNotificationTemplate } from './templates/payment-notification.template.js';
import type { RedisService } from '../../redis/redis.service.js';

function mockFetchResponse(options: {
  ok: boolean;
  status: number;
  bodyText: string;
}): Response {
  return {
    ok: options.ok,
    status: options.status,
    text: async () => options.bodyText,
  } as unknown as Response;
}

describe('MailingService & BrevoMailingProvider', () => {
  const baseConfig: MailingConfig = {
    brevoApiKey: 'xkeysib-super-secret-brevo-key-12345',
    fromName: 'Acme Shop',
    fromEmail: 'verified-sender@acme.test',
    frontendUrl: 'https://shop.acme.test',
    emailVerificationTtlMinutes: 1440,
    passwordResetTtlMinutes: 30,
  };

  let provider: MailingProvider;
  let sendMock: ReturnType<typeof vi.fn>;
  let service: MailingService;

  beforeEach(() => {
    sendMock = vi.fn().mockResolvedValue({
      sent: true,
      provider: 'brevo',
      messageId: '<msg-123@relay.acme.test>',
    });
    provider = {
      name: 'brevo',
      send: sendMock as unknown as MailingProvider['send'],
    };
    service = new MailingService(provider, baseConfig);
  });

  it('sends an email with configured sender metadata', async () => {
    const result = await service.sendMail({
      to: 'customer@example.test',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(result).toEqual({
      sent: true,
      provider: 'brevo',
      messageId: '<msg-123@relay.acme.test>',
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: {
          name: 'Acme Shop',
          email: 'verified-sender@acme.test',
        },
        to: 'customer@example.test',
        subject: 'Hello',
      }),
    );
  });

  it('handles provider failures safely without throwing and redacts BREVO_API_KEY', async () => {
    sendMock.mockRejectedValueOnce(
      new Error('Brevo rejected xkeysib-super-secret-brevo-key-12345'),
    );

    const result = await service.sendMail({
      to: 'customer@example.test',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    });

    expect(result.sent).toBe(false);
    expect(result.provider).toBe('brevo');
    expect(result.error).not.toContain('xkeysib-super-secret-brevo-key-12345');
    expect(result.error).toContain('[REDACTED]');
  });

  it('deduplicates repeated notifications via Redis and releases key on failure', async () => {
    const keys = new Set<string>();
    const redisClient = {
      status: 'ready',
      set: vi.fn(async (key: string) => {
        if (keys.has(key)) return null;
        keys.add(key);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        keys.delete(key);
        return 1;
      }),
    };
    const redis = {
      getClient: () => redisClient,
      connect: vi.fn(),
    } as unknown as RedisService;

    const dedupService = new MailingService(provider, baseConfig, redis);
    const msg = {
      to: 'customer@example.test',
      subject: 'Order Confirmed',
      html: '<p>Confirmed</p>',
      text: 'Confirmed',
    };

    const first = await dedupService.sendMailIdempotent('order:1', msg);
    const second = await dedupService.sendMailIdempotent('order:1', msg);

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.skipped).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);

    // On failure, dedup key is released so a genuine retry can send.
    sendMock.mockRejectedValueOnce(new Error('temporary outage'));
    const failed = await dedupService.sendMailIdempotent('order:2', msg);
    expect(failed.sent).toBe(false);
    expect(redisClient.del).toHaveBeenCalledWith('mail:dedup:order:2');

    const retried = await dedupService.sendMailIdempotent('order:2', msg);
    expect(retried.sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it('builds frontend URLs cleanly with query parameters', () => {
    const url = service.buildFrontendUrl('/reset-password', {
      token: 'abc-123',
    });
    expect(url).toBe('https://shop.acme.test/reset-password?token=abc-123');
  });

  describe('Templates', () => {
    it('renders all templates with HTML, plain text, and XSS escaping', () => {
      const welcome = renderWelcomeEmailTemplate(
        {
          recipientName: '<script>alert(1)</script>',
          frontendUrl: 'https://shop.acme.test',
        },
        'Acme Shop',
      );
      expect(welcome.html).not.toContain('<script>');
      expect(welcome.html).toContain('&lt;script&gt;');
      expect(welcome.text).toContain('https://shop.acme.test');

      const verify = renderEmailVerificationTemplate({
        recipientName: 'Aye Aye',
        verificationUrl: 'https://shop.acme.test/verify-email?token=tok',
        expiresInMinutes: 1440,
      });
      expect(verify.subject).toContain('Verify');
      expect(verify.html).toContain('24 hours');
      expect(verify.text).toContain(
        'https://shop.acme.test/verify-email?token=tok',
      );

      const reset = renderPasswordResetTemplate({
        recipientName: 'Aye Aye',
        resetUrl: 'https://shop.acme.test/reset-password?token=rst',
        expiresInMinutes: 30,
      });
      expect(reset.subject).toContain('Reset');
      expect(reset.html).toContain('30 minutes');
      expect(reset.text).toContain(
        'https://shop.acme.test/reset-password?token=rst',
      );

      const orderConfirm = renderOrderConfirmationTemplate({
        recipientName: 'Aye Aye',
        orderNumber: 'ORD-100',
        totalAmount: '15000.00',
        paymentMethod: 'COD',
        shippingName: 'Aye Aye',
        shippingPhone: '091234567',
        shippingAddress: 'Yangon',
        items: [
          {
            productName: 'Green Tea',
            quantity: 2,
            unitPrice: '7500.00',
            subtotal: '15000.00',
          },
        ],
      });
      expect(orderConfirm.subject).toContain('ORD-100');
      expect(orderConfirm.html).toContain('Green Tea');
      expect(orderConfirm.text).toContain('15000.00');

      const orderStatus = renderOrderStatusTemplate({
        recipientName: 'Aye Aye',
        orderNumber: 'ORD-100',
        previousStatus: 'PENDING',
        newStatus: 'SHIPPED',
        totalAmount: '15000.00',
      });
      expect(orderStatus.subject).toContain('SHIPPED');
      expect(orderStatus.html).toContain('PENDING');

      const payment = renderPaymentNotificationTemplate({
        recipientName: 'Aye Aye',
        orderNumber: 'ORD-100',
        kind: 'MANUAL_REJECTED',
        paymentStatus: 'REJECTED',
        paymentMethod: 'MANUAL',
        amount: '15000.00',
        currency: 'MMK',
        rejectionReason: 'Blurry receipt',
      });
      expect(payment.subject).toContain('Rejected');
      expect(payment.html).toContain('Blurry receipt');
      expect(payment.text).toContain('Blurry receipt');
    });
  });

  describe('BrevoMailingProvider', () => {
    const sampleMessage = {
      sender: { name: 'Acme Shop', email: 'verified@acme.test' },
      to: 'customer@example.test',
      toName: 'Aye Aye',
      subject: 'Welcome',
      html: '<p>Hello</p>',
      text: 'Hello',
    };

    it('sends transactional email to official Brevo HTTPS endpoint and returns messageId', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockFetchResponse({
          ok: true,
          status: 201,
          bodyText: JSON.stringify({
            messageId: '<202611200945.12345@relay.brevo.com>',
          }),
        }),
      );

      const brevo = new BrevoMailingProvider({
        apiKey: 'xkeysib-valid-key-999',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const res = await brevo.send(sampleMessage);

      expect(res).toEqual({
        sent: true,
        provider: 'brevo',
        messageId: '<202611200945.12345@relay.brevo.com>',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(BREVO_TRANSACTIONAL_EMAIL_URL);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'api-key': 'xkeysib-valid-key-999',
        accept: 'application/json',
        'content-type': 'application/json',
      });

      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        sender: { name: 'Acme Shop', email: 'verified@acme.test' },
        to: [{ email: 'customer@example.test', name: 'Aye Aye' }],
        subject: 'Welcome',
        htmlContent: '<p>Hello</p>',
        textContent: 'Hello',
      });
    });

    it('handles Brevo API authentication failure (401) and redacts API key', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockFetchResponse({
          ok: false,
          status: 401,
          bodyText: JSON.stringify({
            code: 'unauthorized',
            message: 'Key not found: xkeysib-secret-auth-key',
          }),
        }),
      );

      const brevo = new BrevoMailingProvider({
        apiKey: 'xkeysib-secret-auth-key',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(brevo.send(sampleMessage)).rejects.toThrow(
        /Brevo authentication failed \(HTTP 401\): Key not found: \[REDACTED\]/,
      );
    });

    it('handles Brevo API validation failure (400)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockFetchResponse({
          ok: false,
          status: 400,
          bodyText: JSON.stringify({
            code: 'invalid_parameter',
            message: 'sender is not valid',
          }),
        }),
      );

      const brevo = new BrevoMailingProvider({
        apiKey: 'xkeysib-valid-key',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(brevo.send(sampleMessage)).rejects.toThrow(
        /Brevo validation error \(HTTP 400\): sender is not valid/,
      );
    });

    it('handles network timeout safely', async () => {
      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      const mockFetch = vi.fn().mockRejectedValue(timeoutError);

      const brevo = new BrevoMailingProvider({
        apiKey: 'xkeysib-valid-key',
        timeoutMs: 2500,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(brevo.send(sampleMessage)).rejects.toThrow(
        /Brevo API request timed out after 2500ms/,
      );
    });

    it('handles network error safely', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new TypeError('fetch failed: ECONNRESET'));

      const brevo = new BrevoMailingProvider({
        apiKey: 'xkeysib-valid-key',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(brevo.send(sampleMessage)).rejects.toThrow(
        /fetch failed: ECONNRESET/,
      );
    });

    it('rejects malformed non-JSON or missing-messageId API responses', async () => {
      const nonJsonFetch = vi.fn().mockResolvedValue(
        mockFetchResponse({
          ok: true,
          status: 201,
          bodyText: '<html>502 Bad Gateway</html>',
        }),
      );
      const brevo1 = new BrevoMailingProvider({
        apiKey: 'xkeysib-valid-key',
        fetchFn: nonJsonFetch as unknown as typeof fetch,
      });
      await expect(brevo1.send(sampleMessage)).rejects.toThrow(
        /malformed non-JSON response/,
      );

      const missingIdFetch = vi.fn().mockResolvedValue(
        mockFetchResponse({
          ok: true,
          status: 201,
          bodyText: JSON.stringify({ ok: true }),
        }),
      );
      const brevo2 = new BrevoMailingProvider({
        apiKey: 'xkeysib-valid-key',
        fetchFn: missingIdFetch as unknown as typeof fetch,
      });
      await expect(brevo2.send(sampleMessage)).rejects.toThrow(
        /missing valid messageId/,
      );
    });

    it('rejects sending when BREVO_API_KEY or sender email is missing', async () => {
      const mockFetch = vi.fn();
      const missingKeyProvider = new BrevoMailingProvider({
        apiKey: '',
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      await expect(missingKeyProvider.send(sampleMessage)).rejects.toThrow(
        /Brevo API key is not configured/,
      );

      const validKeyProvider = new BrevoMailingProvider({
        apiKey: 'xkeysib-valid-key',
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      await expect(
        validKeyProvider.send({
          ...sampleMessage,
          sender: { name: 'Acme', email: '' },
        }),
      ).rejects.toThrow(/MAIL_FROM_EMAIL/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('validateMailingEnvironment', () => {
    it('requires BREVO_API_KEY and valid MAIL_FROM_EMAIL in development and production', () => {
      expect(() =>
        validateMailingEnvironment({
          NODE_ENV: 'production',
          MAIL_FROM_EMAIL: 'verified@acme.test',
        }),
      ).toThrow(/BREVO_API_KEY/);

      expect(() =>
        validateMailingEnvironment({
          NODE_ENV: 'production',
          BREVO_API_KEY: 'xkeysib-123',
        }),
      ).toThrow(/MAIL_FROM_EMAIL/);

      expect(() =>
        validateMailingEnvironment({
          NODE_ENV: 'development',
          BREVO_API_KEY: 'xkeysib-123',
          MAIL_FROM_EMAIL: 'not-an-email',
        }),
      ).toThrow(/valid email address/);
    });

    it('accepts valid Brevo configuration', () => {
      const parsed = validateMailingEnvironment({
        NODE_ENV: 'production',
        BREVO_API_KEY: 'xkeysib-123',
        MAIL_FROM_NAME: 'My E-commerce Store',
        MAIL_FROM_EMAIL: 'verified@acme.test',
        FRONTEND_URL: 'https://shop.acme.test/',
      });
      expect(parsed).toEqual({
        BREVO_API_KEY: 'xkeysib-123',
        MAIL_FROM_NAME: 'My E-commerce Store',
        MAIL_FROM_EMAIL: 'verified@acme.test',
        FRONTEND_URL: 'https://shop.acme.test',
        EMAIL_VERIFICATION_TTL_MINUTES: 1440,
        PASSWORD_RESET_TTL_MINUTES: 30,
      });
    });

    it('rejects invalid FRONTEND_URL', () => {
      expect(() =>
        validateMailingEnvironment({
          NODE_ENV: 'test',
          FRONTEND_URL: 'ftp://bad.example',
        }),
      ).toThrow(/FRONTEND_URL/);
    });
  });
});

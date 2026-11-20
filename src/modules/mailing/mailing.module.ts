import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAILING_CONFIG, MAILING_PROVIDER } from './mailing.constants.js';
import { getMailingConfig } from './mailing-config.js';
import type { MailingConfig } from './mailing.interface.js';
import { MailingService } from './mailing.service.js';
import type { MailingProvider } from './providers/mailing-provider.interface.js';
import { BrevoMailingProvider } from './providers/brevo-mailing.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: MAILING_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailingConfig =>
        getMailingConfig(config),
    },
    {
      provide: MAILING_PROVIDER,
      inject: [MAILING_CONFIG],
      useFactory: (mailingConfig: MailingConfig): MailingProvider =>
        new BrevoMailingProvider({
          apiKey: mailingConfig.brevoApiKey,
        }),
    },
    MailingService,
  ],
  exports: [MailingService, MAILING_PROVIDER, MAILING_CONFIG],
})
export class MailingModule {}

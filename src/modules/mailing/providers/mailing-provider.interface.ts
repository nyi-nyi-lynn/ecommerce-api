import type { MailMessage, MailSendResult } from '../mailing.interface.js';

export interface MailingProvider {
  readonly name: string;
  send(message: MailMessage): Promise<MailSendResult>;
}

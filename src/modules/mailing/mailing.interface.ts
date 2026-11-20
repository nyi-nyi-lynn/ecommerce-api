export interface MailingConfig {
  brevoApiKey: string;
  fromName: string;
  fromEmail: string;
  frontendUrl: string;
  emailVerificationTtlMinutes: number;
  passwordResetTtlMinutes: number;
}

export interface MailSender {
  name: string;
  email: string;
}

export interface MailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  sender?: MailSender;
  replyTo?: string;
}

export interface MailSendResult {
  sent: boolean;
  provider: string;
  messageId?: string;
  skipped?: boolean;
  error?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface WelcomeEmailPayload {
  recipientName: string;
  frontendUrl: string;
}

export interface EmailVerificationPayload {
  recipientName: string;
  verificationUrl: string;
  expiresInMinutes: number;
}

export interface PasswordResetPayload {
  recipientName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface OrderConfirmationItem {
  productName: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
}

export interface OrderConfirmationPayload {
  recipientName: string;
  orderNumber: string;
  totalAmount: string;
  paymentMethod: string;
  shippingName: string;
  shippingPhone: string;
  shippingAddress: string;
  items: OrderConfirmationItem[];
  orderUrl?: string;
}

export interface OrderStatusPayload {
  recipientName: string;
  orderNumber: string;
  previousStatus?: string;
  newStatus: string;
  totalAmount: string;
  orderUrl?: string;
}

export type PaymentNotificationKind =
  | 'MANUAL_SUBMITTED'
  | 'MANUAL_APPROVED'
  | 'MANUAL_REJECTED'
  | 'COD_COLLECTED'
  | 'STATUS_UPDATED';

export interface PaymentNotificationPayload {
  recipientName: string;
  orderNumber: string;
  kind: PaymentNotificationKind;
  paymentStatus: string;
  paymentMethod: string;
  amount: string;
  currency: string;
  providerCode?: string | null;
  transactionReference?: string | null;
  rejectionReason?: string | null;
  orderUrl?: string;
}

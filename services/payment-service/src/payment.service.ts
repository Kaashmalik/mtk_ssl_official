import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeProvider } from './providers/stripe.provider';
import { JazzCashProvider } from './providers/jazzcash.provider';
import { env } from './env';
import { db, payments } from '@mtk/database';
import { and, desc, eq } from 'drizzle-orm';

interface CreatePaymentDto {
  tenantId: string;
  userId: string;
  amount: number;
  currency: string;
  provider: 'stripe' | 'jazzcash' | 'easypaisa';
  metadata?: Record<string, string>;
  description?: string;
  returnUrl?: string;
}

interface Payment {
  id: string;
  tenantId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  provider: string;
  providerPaymentId?: string;
  checkoutUrl?: string;
  metadata?: Record<string, string>;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

type PaymentRow = typeof payments.$inferSelect;

function toPayment(row: PaymentRow): Payment {
  const meta = (row.metadata ?? {}) as Record<string, string>;
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId ?? '',
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as Payment['status'],
    provider: row.paymentMethod,
    providerPaymentId: row.externalPaymentId ?? undefined,
    checkoutUrl: meta.checkoutUrl,
    metadata: meta,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly configService: ConfigService,
    private readonly stripeProvider: StripeProvider,
    private readonly jazzCashProvider: JazzCashProvider,
  ) {}

  async createPayment(dto: CreatePaymentDto): Promise<Payment> {
    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    if (!env.ONLINE_PAYMENTS_ENABLED) {
      throw new BadRequestException(
        'Online payment providers are disabled until merchant credentials are live. Use manual JazzCash / EasyPaisa / bank transfer via the web app.',
      );
    }

    let providerResult: { paymentId: string; checkoutUrl?: string };

    const id = crypto.randomUUID();

    switch (dto.provider) {
      case 'stripe':
        providerResult = await this.stripeProvider.createPaymentIntent({
          amount: dto.amount,
          currency: dto.currency,
          metadata: dto.metadata,
          description: dto.description,
        });
        break;
      case 'jazzcash':
        providerResult = await this.jazzCashProvider.createPayment({
          amount: dto.amount,
          currency: dto.currency || 'PKR',
          description: dto.description,
          returnUrl: dto.returnUrl,
        });
        break;
      case 'easypaisa':
        providerResult = { paymentId: `EP-${id}`, checkoutUrl: `https://easypaisa.com/pay/${id}` };
        break;
      default:
        throw new BadRequestException(`Unsupported payment provider: ${dto.provider}`);
    }

    const metadata: Record<string, string> = { ...(dto.metadata ?? {}) };
    if (providerResult.checkoutUrl) metadata.checkoutUrl = providerResult.checkoutUrl;

    const [row] = await db.insert(payments).values({
      tenantId: dto.tenantId,
      userId: dto.userId,
      amount: dto.amount.toFixed(2),
      currency: dto.currency,
      paymentMethod: dto.provider,
      status: 'pending',
      externalPaymentId: providerResult.paymentId,
      description: dto.description,
      metadata,
    }).returning();

    return toPayment(row);
  }

  async getPayment(id: string, tenantId: string): Promise<Payment> {
    const [row] = await db.select().from(payments)
      .where(and(eq(payments.id, id), eq(payments.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException(`Payment ${id} not found`);
    return toPayment(row);
  }

  async confirmPayment(id: string, tenantId: string, providerPaymentId: string): Promise<Payment> {
    const payment = await this.getPayment(id, tenantId);

    if (payment.status !== 'pending') {
      throw new BadRequestException('Payment is not in pending state');
    }

    let verified = false;
    switch (payment.provider) {
      case 'stripe':
        verified = await this.stripeProvider.verifyPayment(providerPaymentId);
        break;
      case 'jazzcash':
        verified = await this.jazzCashProvider.verifyPayment(providerPaymentId);
        break;
      default:
        verified = true;
    }

    const [row] = await db.update(payments)
      .set({
        status: verified ? 'completed' : 'failed',
        completedAt: verified ? new Date() : null,
        paidAt: verified ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, id), eq(payments.tenantId, tenantId)))
      .returning();

    return toPayment(row);
  }

  async refundPayment(id: string, tenantId: string, reason?: string): Promise<Payment> {
    const payment = await this.getPayment(id, tenantId);

    if (payment.status !== 'completed') {
      throw new BadRequestException('Only completed payments can be refunded');
    }

    switch (payment.provider) {
      case 'stripe':
        await this.stripeProvider.refundPayment(payment.providerPaymentId!, reason);
        break;
      case 'jazzcash':
        await this.jazzCashProvider.refundPayment(payment.providerPaymentId!, reason);
        break;
    }

    const [row] = await db.update(payments)
      .set({ status: 'refunded', refundReason: reason ?? null, refundedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payments.id, id), eq(payments.tenantId, tenantId)))
      .returning();

    return toPayment(row);
  }

  async listPayments(tenantId: string, userId?: string, status?: string): Promise<Payment[]> {
    const query = db.select().from(payments).where(eq(payments.tenantId, tenantId)).orderBy(desc(payments.createdAt));
    const rows = await query;
    return rows
      .filter((p) => !userId || p.userId === userId)
      .filter((p) => !status || p.status === status)
      .map(toPayment);
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = this.stripeProvider.verifyWebhook(rawBody, signature);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as { id: string };
        await db.update(payments)
          .set({ status: 'completed', completedAt: new Date(), paidAt: new Date(), updatedAt: new Date() })
          .where(eq(payments.externalPaymentId, paymentIntent.id));
        break;
      }
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as { id: string };
        await db.update(payments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(payments.externalPaymentId, paymentIntent.id));
        break;
      }
      default:
        break;
    }
  }
}

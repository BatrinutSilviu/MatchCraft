import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type PlanKind = 'event' | 'club';

export interface CheckoutRequest {
  kind: PlanKind;
  userId: string;
  email: string;
  customerId?: string | null;
  tournamentId?: string;
  successUrl: string;
  cancelUrl: string;
}

export type BillingEvent =
  | { type: 'checkout.completed'; sessionId: string; customerId?: string; subscriptionId?: string }
  | { type: 'subscription.changed'; subscriptionId: string; active: boolean }
  | { type: 'ignored' };

export interface Billing {
  readonly kind: 'stripe' | 'fake';
  /** Starts a hosted checkout; returns the session id to remember and the URL to send the buyer to. */
  checkout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  /** Link to manage or cancel a subscription; null when the provider has none. */
  portal(customerId: string, returnUrl: string): Promise<string | null>;
  /** Verifies and decodes a webhook call. Throws when the signature is wrong. */
  parseWebhook(raw: Buffer, signature: string | undefined): BillingEvent;
}

export interface PriceDisplay {
  /** Shown on upgrade buttons, e.g. "€19". */
  event: string;
  /** e.g. "€29 / month". */
  club: string;
}

const STRIPE_API = 'https://api.stripe.com/v1';

/** Stripe Checkout over plain HTTPS, so there is no SDK to keep up to date. */
export class StripeBilling implements Billing {
  readonly kind = 'stripe';

  constructor(
    private secretKey: string,
    private webhookSecret: string,
    private prices: { event: string; club: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const message = (data.error as { message?: string } | undefined)?.message ?? res.statusText;
      throw new Error(`Stripe ${path} failed: ${message}`);
    }
    return data;
  }

  async checkout(req: CheckoutRequest) {
    const params: Record<string, string> = {
      mode: req.kind === 'club' ? 'subscription' : 'payment',
      'line_items[0][price]': req.kind === 'club' ? this.prices.club : this.prices.event,
      'line_items[0][quantity]': '1',
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      client_reference_id: req.userId,
      'metadata[kind]': req.kind,
      allow_promotion_codes: 'true',
    };
    if (req.tournamentId) params['metadata[tournament_id]'] = req.tournamentId;
    if (req.customerId) params.customer = req.customerId;
    else {
      params.customer_email = req.email;
      if (req.kind === 'event') params.customer_creation = 'always';
    }
    const session = await this.call('/checkout/sessions', params);
    return { id: String(session.id), url: String(session.url) };
  }

  async portal(customerId: string, returnUrl: string) {
    const session = await this.call('/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
    return String(session.url);
  }

  parseWebhook(raw: Buffer, signature: string | undefined): BillingEvent {
    verifyStripeSignature(raw, signature, this.webhookSecret);
    const event = JSON.parse(raw.toString('utf8')) as { type: string; data: { object: Record<string, unknown> } };
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') return { type: 'ignored' };
        return {
          type: 'checkout.completed',
          sessionId: String(obj.id),
          customerId: typeof obj.customer === 'string' ? obj.customer : undefined,
          subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : undefined,
        };
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // past_due keeps access while Stripe retries the card.
        const active = event.type === 'customer.subscription.updated'
          && ['active', 'trialing', 'past_due'].includes(String(obj.status));
        return { type: 'subscription.changed', subscriptionId: String(obj.id), active };
      }
      default:
        return { type: 'ignored' };
    }
  }
}

/** Stripe signs `${timestamp}.${body}` with HMAC-SHA256; reject old timestamps to stop replays. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, now = Date.now(), toleranceSec = 300) {
  if (!header) throw new Error('Missing signature');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) throw new Error('Malformed signature');
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) throw new Error('Signature too old');
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  const ok = sigs.some((s) => {
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new Error('Bad signature');
}

/**
 * Development stand-in: "checkout" is a link back to this server that marks the payment as done.
 * Lets you try the whole upgrade flow locally without a Stripe account. Never enable in production.
 */
export class FakeBilling implements Billing {
  readonly kind = 'fake';
  constructor(private apiBase: string) {}

  async checkout(req: CheckoutRequest) {
    const id = `fake_${randomBytes(12).toString('hex')}`;
    const url = `${this.apiBase}/api/billing/fake/complete?session=${id}&next=${encodeURIComponent(req.successUrl)}`;
    return { id, url };
  }

  async portal() {
    return null;
  }

  parseWebhook(): BillingEvent {
    throw new Error('Fake billing has no webhooks');
  }
}

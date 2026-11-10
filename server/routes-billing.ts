import express, { Router } from 'express';
import { requireUser, userOf, type Ctx } from './http';
import type { BillingEvent, PlanKind } from './billing';

/** Upgrades: a one-off Pro pass for one tournament, or a Club subscription covering everything you own. */
export function billingRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = Router();
  const base = ctx.appUrl.replace(/\/$/, '');

  r.get('/config', (_req, res) => {
    res.json({
      billing: ctx.billing
        ? { enabled: true, provider: ctx.billing.kind, prices: ctx.prices, freeParticipantLimit: ctx.freeParticipantLimit }
        : { enabled: false },
    });
  });

  r.post('/billing/checkout', requireUser(ctx), async (req, res) => {
    const { billing } = ctx;
    if (!billing) return void res.status(404).json({ error: 'Billing is not enabled.' });
    const user = userOf(req);
    const kind = req.body?.kind as PlanKind;
    if (kind !== 'event' && kind !== 'club') return void res.status(400).json({ error: 'Pick a plan.' });
    const account = db.prepare('SELECT plan, stripe_customer_id FROM users WHERE id = ?').get(user.id) as
      { plan: string; stripe_customer_id: string | null };

    let tournamentId: string | undefined;
    let back = `${base}/#/account`;
    if (kind === 'event') {
      tournamentId = String(req.body?.tournamentId ?? '');
      const row = db.prepare(
        `SELECT plan FROM tournaments WHERE id = @t AND (owner_id = @u
           OR id IN (SELECT tournament_id FROM tournament_members WHERE user_id = @u))`,
      ).get({ t: tournamentId, u: user.id }) as { plan: string } | undefined;
      if (!row) return void res.status(404).json({ error: 'Tournament not found.' });
      if (row.plan === 'pro') return void res.status(409).json({ error: 'This tournament is already Pro.' });
      back = `${base}/#/t/${encodeURIComponent(tournamentId)}`;
    } else if (account.plan === 'club') {
      return void res.status(409).json({ error: 'You already have the Club plan.' });
    }

    try {
      const session = await billing.checkout({
        kind, userId: user.id, email: user.email, customerId: account.stripe_customer_id, tournamentId,
        successUrl: `${back}${back.includes('?') ? '&' : '?'}upgraded=1`, cancelUrl: back,
      });
      db.prepare('INSERT INTO payments (session_id, user_id, kind, tournament_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(session.id, user.id, kind, tournamentId ?? null, Date.now());
      res.json({ url: session.url });
    } catch (err) {
      console.error('Checkout failed:', err);
      res.status(502).json({ error: 'We couldn’t start the payment. Please try again.' });
    }
  });

  r.post('/billing/portal', requireUser(ctx), async (req, res) => {
    const account = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(userOf(req).id) as { stripe_customer_id: string | null };
    if (!ctx.billing || !account.stripe_customer_id) return void res.status(404).json({ error: 'There is no subscription to manage.' });
    try {
      const url = await ctx.billing.portal(account.stripe_customer_id, `${base}/#/account`);
      if (!url) return void res.status(404).json({ error: 'There is no subscription to manage.' });
      res.json({ url });
    } catch (err) {
      console.error('Billing portal failed:', err);
      res.status(502).json({ error: 'We couldn’t open billing right now. Please try again.' });
    }
  });

  /** Applies a confirmed payment; safe to call more than once for the same session. */
  const apply = (event: BillingEvent) => {
    if (event.type === 'checkout.completed') {
      db.transaction(() => {
        const pay = db.prepare('SELECT user_id, kind, tournament_id, paid_at FROM payments WHERE session_id = ?').get(event.sessionId) as
          { user_id: string; kind: PlanKind; tournament_id: string | null; paid_at: number | null } | undefined;
        if (!pay || pay.paid_at) return;
        db.prepare('UPDATE payments SET paid_at = ? WHERE session_id = ?').run(Date.now(), event.sessionId);
        if (event.customerId) {
          db.prepare('UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?').run(event.customerId, pay.user_id);
        }
        if (pay.kind === 'event' && pay.tournament_id) {
          db.prepare(`UPDATE tournaments SET plan = 'pro', version = version + 1 WHERE id = ?`).run(pay.tournament_id);
        } else if (pay.kind === 'club') {
          db.prepare(`UPDATE users SET plan = 'club', subscription_id = ? WHERE id = ?`).run(event.subscriptionId ?? null, pay.user_id);
        }
        if (pay.tournament_id) {
          const row = db.prepare('SELECT version FROM tournaments WHERE id = ?').get(pay.tournament_id) as { version: number } | undefined;
          if (row) ctx.live.publish(pay.tournament_id, { version: row.version });
        }
      })();
    } else if (event.type === 'subscription.changed') {
      db.prepare(`UPDATE users SET plan = ? WHERE subscription_id = ?`).run(event.active ? 'club' : 'free', event.subscriptionId);
    }
  };

  // Stripe needs the exact bytes it signed, so this route reads the raw body.
  r.post('/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (!ctx.billing || ctx.billing.kind !== 'stripe') return void res.status(404).json({ error: 'Not found.' });
    let event: BillingEvent;
    try {
      event = ctx.billing.parseWebhook(req.body as Buffer, req.get('Stripe-Signature'));
    } catch {
      return void res.status(400).json({ error: 'Invalid signature.' });
    }
    apply(event);
    res.json({ received: true });
  });

  // Local testing only: completes a fake checkout as if the payment went through.
  r.get('/billing/fake/complete', requireUser(ctx), (req, res) => {
    if (ctx.billing?.kind !== 'fake') return void res.status(404).json({ error: 'Not found.' });
    const sessionId = String(req.query.session ?? '');
    const pay = db.prepare('SELECT user_id FROM payments WHERE session_id = ?').get(sessionId) as { user_id: string } | undefined;
    if (!pay || pay.user_id !== userOf(req).id) return void res.status(404).json({ error: 'Unknown checkout.' });
    apply({ type: 'checkout.completed', sessionId, customerId: undefined, subscriptionId: `fake_sub_${pay.user_id}` });
    const next = String(req.query.next ?? '');
    res.redirect(next.startsWith(`${base}/`) ? next : `${base}/`);
  });

  return r;
}

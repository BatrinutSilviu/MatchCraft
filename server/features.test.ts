import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { openDb, type DB } from './db';
import { createApp } from './app';
import { ConsoleMailer } from './mailer';
import { FakeBilling, StripeBilling, verifyStripeSignature } from './billing';

const mailer = new ConsoleMailer(true);
const WEBHOOK_SECRET = 'whsec_test';

interface Running { server: Server; base: string; db: DB; close: () => void }

async function start(opts: Parameters<typeof createApp>[1]): Promise<Running> {
  const db = openDb(':memory:');
  const app = createApp(db, { mailer, ...opts });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, db, close: () => { app.live.closeAll(); server.close(); } };
}

function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-Matchcraft': '1' }) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json: Record<string, any> = {};
    try { json = JSON.parse(text); } catch { /* redirects and empty bodies */ }
    return { status: res.status, body: json, headers: res.headers };
  };
}

let n = 0;
async function account(base: string) {
  const api = client(base);
  await api('POST', '/api/signup', { email: `user${++n}@example.com`, password: 'longenough', name: `User${n}` });
  return api;
}

const people = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seed: i + 1 }));
const tournament = (extra: Record<string, unknown> = {}) => ({
  name: 'Cup', participants: people(2), matches: [], rules: {}, format: { kind: 'league' }, ...extra,
});
const setup = (capacity: number) => tournament({ phase: 'setup', participants: [], registration: { open: true, capacity } });

describe('self-registration', () => {
  let app: Running;
  beforeAll(async () => { app = await start({ appUrl: 'https://mc.test' }); });
  afterAll(() => app.close());

  it('adds sign-ups until full, then waitlists, and keeps emails private', async () => {
    const owner = await account(app.base);
    await owner('PUT', '/api/tournaments/r1', { tournament: setup(2) });
    const { shareId } = (await owner('POST', '/api/tournaments/r1/share', { enabled: true })).body;
    const visitor = client(app.base);
    const join = (name: string, email: string) => visitor('POST', `/api/public/${shareId}/register`, { name, email });

    expect((await join('Ana', 'ana@example.com')).body.status).toBe('entered');
    expect((await join('ana', 'other@example.com')).status).toBe(409);
    expect((await join('Someone', 'ANA@example.com')).status).toBe(409);
    expect((await join('Bob', 'bob@example.com')).body.status).toBe('entered');
    expect((await join('Cat', 'cat@example.com')).body.status).toBe('waitlist');
    expect((await join('', 'x@example.com')).status).toBe(400);
    expect(mailer.sent.some((m) => m.to === 'cat@example.com' && m.subject.includes('waitlist'))).toBe(true);

    const pub = (await visitor('GET', `/api/public/${shareId}`)).body;
    expect(pub.tournament.participants.map((p: { name: string }) => p.name)).toEqual(['Ana', 'Bob']);
    expect(pub.waitlist).toBe(1);
    expect(JSON.stringify(pub)).not.toContain('@example.com');

    const regs = (await owner('GET', '/api/tournaments/r1/registrations')).body.registrations;
    expect(regs.map((r: { email: string }) => r.email)).toEqual(['ana@example.com', 'bob@example.com', 'cat@example.com']);
    expect((await client(app.base)('GET', '/api/tournaments/r1/registrations')).status).toBe(401);
    const stranger = await account(app.base);
    expect((await stranger('GET', '/api/tournaments/r1/registrations')).status).toBe(404);

    expect((await owner('DELETE', `/api/tournaments/r1/registrations/${regs[2].id}`)).status).toBe(200);
    expect((await owner('GET', '/api/tournaments/r1/registrations')).body.registrations).toHaveLength(2);
  });

  it('refuses sign-ups once closed or started', async () => {
    const owner = await account(app.base);
    await owner('PUT', '/api/tournaments/r2', { tournament: tournament() });
    const { shareId } = (await owner('POST', '/api/tournaments/r2/share', { enabled: true })).body;
    const res = await client(app.base)('POST', `/api/public/${shareId}/register`, { name: 'Late', email: 'late@example.com' });
    expect(res.status).toBe(409);
  });
});

describe('plans', () => {
  let app: Running;
  beforeAll(async () => {
    app = await start({ appUrl: 'http://localhost:0', billing: new FakeBilling('http://localhost:0'), freeParticipantLimit: 4 });
  });
  afterAll(() => app.close());

  it('exposes billing config', async () => {
    const { body } = await client(app.base)('GET', '/api/config');
    expect(body.billing).toMatchObject({ enabled: true, provider: 'fake', freeParticipantLimit: 4 });
  });

  it('limits free tournaments, then unlocks them with an event pass', async () => {
    const owner = await account(app.base);
    expect((await owner('PUT', '/api/tournaments/f0', { tournament: tournament({ participants: people(5) }) })).status).toBe(402);
    const created = await owner('PUT', '/api/tournaments/f1', { tournament: tournament({ participants: people(4) }) });
    expect(created.body.tournament.pro).toBe(false);

    const grow = await owner('PUT', '/api/tournaments/f1', { tournament: tournament({ participants: people(5) }), baseVersion: 1 });
    expect(grow.status).toBe(402);
    expect(grow.body.code).toBe('upgrade');
    const brand = await owner('PUT', '/api/tournaments/f1', { tournament: tournament({ branding: { accent: '#ff0000' } }), baseVersion: 1 });
    expect(brand.status).toBe(402);

    const { url } = (await owner('POST', '/api/billing/checkout', { kind: 'event', tournamentId: 'f1' })).body;
    expect(url).toContain('/api/billing/fake/complete?session=');
    // Someone else can't complete your checkout.
    const other = await account(app.base);
    const path = url.replace('http://localhost:0', '');
    expect((await other('GET', path)).status).toBe(404);
    expect((await owner('GET', path)).status).toBe(302);
    expect((await owner('GET', path)).status).toBe(302); // idempotent

    const t = (await owner('GET', '/api/tournaments/f1')).body.tournament;
    expect(t.pro).toBe(true);
    expect((await owner('PUT', '/api/tournaments/f1', {
      tournament: tournament({ participants: people(9), branding: { accent: '#ff0000' } }), baseVersion: t.version,
    })).status).toBe(200);
    expect((await owner('POST', '/api/billing/checkout', { kind: 'event', tournamentId: 'f1' })).status).toBe(409);
  });

  it('caps free sign-ups at the free limit', async () => {
    const owner = await account(app.base);
    await owner('PUT', '/api/tournaments/f2', { tournament: setup(0) });
    const { shareId } = (await owner('POST', '/api/tournaments/f2/share', { enabled: true })).body;
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await client(app.base)('POST', `/api/public/${shareId}/register`, { name: `N${i}`, email: `n${i}@f2.com` })).body.status);
    }
    expect(statuses).toEqual(['entered', 'entered', 'entered', 'entered', 'waitlist']);
  });

  it('a Club plan unlocks every tournament the user owns', async () => {
    const owner = await account(app.base);
    const { url } = (await owner('POST', '/api/billing/checkout', { kind: 'club' })).body;
    await owner('GET', url.replace('http://localhost:0', ''));
    expect((await owner('GET', '/api/me')).body.user.plan).toBe('club');
    expect((await owner('PUT', '/api/tournaments/c1', { tournament: tournament({ participants: people(20) }) })).status).toBe(201);
  });

  it('rejects unsafe branding', async () => {
    const owner = await account(app.base);
    const bad = await owner('PUT', '/api/tournaments/b1', {
      tournament: tournament({ branding: { sponsors: [{ name: 'X', url: 'javascript:alert(1)' }] } }),
    });
    expect(bad.status).toBe(400);
    const svg = await owner('PUT', '/api/tournaments/b2', { tournament: tournament({ branding: { logo: 'data:image/svg+xml;base64,PHN2Zz4=' } }) });
    expect(svg.status).toBe(400);
  });
});

describe('billing off', () => {
  let app: Running;
  beforeAll(async () => { app = await start({ freeParticipantLimit: 2 }); });
  afterAll(() => app.close());

  it('unlocks everything when billing is not configured', async () => {
    const owner = await account(app.base);
    const res = await owner('PUT', '/api/tournaments/o1', { tournament: tournament({ participants: people(30), branding: { accent: '#123456' } }) });
    expect(res.status).toBe(201);
    expect(res.body.tournament.pro).toBe(true);
    expect((await client(app.base)('GET', '/api/config')).body.billing).toEqual({ enabled: false });
  });
});

describe('stripe', () => {
  const sign = (body: string, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')}`;

  it('verifies webhook signatures', () => {
    const body = '{"a":1}';
    expect(() => verifyStripeSignature(Buffer.from(body), sign(body), WEBHOOK_SECRET)).not.toThrow();
    expect(() => verifyStripeSignature(Buffer.from(body), sign('{"a":2}'), WEBHOOK_SECRET)).toThrow();
    expect(() => verifyStripeSignature(Buffer.from(body), sign(body, 1000), WEBHOOK_SECRET)).toThrow(/old/);
    expect(() => verifyStripeSignature(Buffer.from(body), undefined, WEBHOOK_SECRET)).toThrow();
  });

  it('creates a checkout session and applies the signed webhook once', async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ id: 'cs_123', url: 'https://checkout.stripe.test/cs_123' }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = await start({
      appUrl: 'https://mc.test', freeParticipantLimit: 2,
      billing: new StripeBilling('sk_test', WEBHOOK_SECRET, { event: 'price_event', club: 'price_club' }, fakeFetch),
    });
    try {
      const owner = await account(app.base);
      await owner('PUT', '/api/tournaments/s1', { tournament: tournament() });
      const { url } = (await owner('POST', '/api/billing/checkout', { kind: 'event', tournamentId: 's1' })).body;
      expect(url).toBe('https://checkout.stripe.test/cs_123');
      const sent = new URLSearchParams(calls[0].body);
      expect(sent.get('mode')).toBe('payment');
      expect(sent.get('line_items[0][price]')).toBe('price_event');
      expect(sent.get('success_url')).toBe('https://mc.test/#/t/s1?upgraded=1');

      const event = JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123', customer: 'cus_1', payment_status: 'paid' } },
      });
      const anon = client(app.base);
      expect((await anon('POST', '/api/billing/webhook', event, { 'Stripe-Signature': 'bad' })).status).toBe(400);
      expect((await anon('POST', '/api/billing/webhook', event, { 'Stripe-Signature': sign(event) })).status).toBe(200);
      expect((await anon('POST', '/api/billing/webhook', event, { 'Stripe-Signature': sign(event) })).status).toBe(200);
      expect((await owner('GET', '/api/tournaments/s1')).body.tournament.pro).toBe(true);
      expect(app.db.prepare('SELECT stripe_customer_id FROM users WHERE stripe_customer_id IS NOT NULL').all()).toEqual([{ stripe_customer_id: 'cus_1' }]);
    } finally {
      app.close();
    }
  });

  it('ends Club access when the subscription is cancelled', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ id: 'cs_club', url: 'https://x' }), { status: 200 })) as unknown as typeof fetch;
    const app = await start({ billing: new StripeBilling('sk', WEBHOOK_SECRET, { event: 'e', club: 'c' }, fakeFetch) });
    try {
      const owner = await account(app.base);
      await owner('POST', '/api/billing/checkout', { kind: 'club' });
      const hook = (obj: object, type: string) => {
        const body = JSON.stringify({ type, data: { object: obj } });
        return client(app.base)('POST', '/api/billing/webhook', body, { 'Stripe-Signature': sign(body) });
      };
      await hook({ id: 'cs_club', customer: 'cus_c', subscription: 'sub_1', payment_status: 'paid' }, 'checkout.session.completed');
      expect((await owner('GET', '/api/me')).body.user.plan).toBe('club');
      await hook({ id: 'sub_1', status: 'canceled' }, 'customer.subscription.deleted');
      expect((await owner('GET', '/api/me')).body.user.plan).toBe('free');
    } finally {
      app.close();
    }
  });
});

describe('live updates', () => {
  it('pushes the new version to organisers and spectators', async () => {
    const app = await start({});
    try {
      const owner = await account(app.base);
      await owner('PUT', '/api/tournaments/l1', { tournament: tournament() });
      const { shareId } = (await owner('POST', '/api/tournaments/l1/share', { enabled: true })).body;

      const ctrl = new AbortController();
      const res = await fetch(`${app.base}/api/public/${shareId}/live`, { signal: ctrl.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const read = async () => {
        let text = '';
        while (!text.includes('data:')) text += new TextDecoder().decode((await reader.read()).value);
        return text;
      };
      await owner('PUT', '/api/tournaments/l1', { tournament: tournament({ name: 'Live' }), baseVersion: 1 });
      expect(await read()).toContain('data: {"version":2}');
      ctrl.abort();
      expect((await fetch(`${app.base}/api/tournaments/l1/live`)).status).toBe(401);
    } finally {
      app.close();
    }
  });
});

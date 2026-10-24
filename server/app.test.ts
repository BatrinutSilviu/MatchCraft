import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from './db';
import { createApp } from './app';
import { ConsoleMailer } from './mailer';

const mailer = new ConsoleMailer(true);
let server: Server;
let base = '';

beforeAll(async () => {
  server = createApp(openDb(':memory:'), { mailer, appUrl: 'https://mc.test' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

/** Tiny client that keeps its own session cookie. */
function client() {
  let cookie = '';
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-Matchcraft': '1' }) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

/** Pulls the token out of the latest email sent to `to` whose link points at `route`. */
function tokenFrom(to: string, route: string): string {
  const mail = [...mailer.sent].reverse().find((m) => m.to === to && m.text.includes(`#${route}?token=`));
  if (!mail) throw new Error(`No ${route} email for ${to}`);
  expect(mail.text).toContain('https://mc.test/#');
  return decodeURIComponent(mail.text.match(new RegExp(`#${route}\\?token=([^\\s]+)`))![1]);
}

let n = 0;
async function account(name = 'User', opts: { verified?: boolean } = {}) {
  const api = client();
  const email = `${name.toLowerCase()}${++n}@example.com`;
  await api('POST', '/api/signup', { email, password: 'longenough', name });
  if (opts.verified) await api('POST', '/api/verify', { token: tokenFrom(email, '/verify') });
  return { api, email };
}

const tournament = (name = 'Cup') => ({
  name, participants: [{ id: 'a', name: 'A', seed: 1 }], matches: [], rules: {}, format: { kind: 'league' },
});

describe('auth', () => {
  it('signs up, reads the session, logs out and back in', async () => {
    const api = client();
    expect((await api('GET', '/api/me')).body.user).toBeNull();
    const signup = await api('POST', '/api/signup', { email: 'Ana@Example.com', password: 'longenough', name: 'Ana' });
    expect(signup.status).toBe(201);
    expect((await api('GET', '/api/me')).body.user).toMatchObject({ email: 'ana@example.com', name: 'Ana', emailVerified: false });
    await api('POST', '/api/logout');
    expect((await api('GET', '/api/me')).body.user).toBeNull();
    expect((await api('POST', '/api/login', { email: 'ana@example.com', password: 'wrong-pass' })).status).toBe(401);
    expect((await api('POST', '/api/login', { email: 'ANA@example.com', password: 'longenough' })).status).toBe(200);
  });

  it('rejects weak input and duplicate accounts', async () => {
    const api = client();
    expect((await api('POST', '/api/signup', { email: 'nope', password: 'longenough' })).status).toBe(400);
    expect((await api('POST', '/api/signup', { email: 'b@example.com', password: 'short' })).status).toBe(400);
    await api('POST', '/api/signup', { email: 'dup@example.com', password: 'longenough' });
    expect((await client()('POST', '/api/signup', { email: 'dup@example.com', password: 'longenough' })).status).toBe(409);
  });

  it('requires the custom header on mutations', async () => {
    const res = await client()('POST', '/api/signup', { email: 'c@example.com', password: 'longenough' }, {});
    expect(res.status).toBe(403);
  });

  it('rate limits repeated failed logins', async () => {
    const api = client();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await api('POST', '/api/login', { email: 'x@example.com', password: 'whatever1' })).status;
    expect(last).toBe(429);
  });
});

describe('email verification', () => {
  it('verifies with the emailed single-use link', async () => {
    const { api, email } = await account('Vera');
    const token = tokenFrom(email, '/verify');
    // The link works without being logged in, e.g. opened on another device.
    expect((await client()('POST', '/api/verify', { token })).status).toBe(200);
    expect((await api('GET', '/api/me')).body.user.emailVerified).toBe(true);
    expect((await api('POST', '/api/verify', { token })).status).toBe(400);
    expect((await api('POST', '/api/verify/resend')).status).toBe(400);
  });

  it('resends a new link, invalidating the old one, and limits resends', async () => {
    const { api, email } = await account('Rex');
    const first = tokenFrom(email, '/verify');
    expect((await api('POST', '/api/verify/resend')).status).toBe(200);
    const second = tokenFrom(email, '/verify');
    expect(second).not.toBe(first);
    expect((await api('POST', '/api/verify', { token: first })).status).toBe(400);
    await api('POST', '/api/verify/resend');
    await api('POST', '/api/verify/resend');
    expect((await api('POST', '/api/verify/resend')).status).toBe(429);
    expect((await api('POST', '/api/verify', { token: tokenFrom(email, '/verify') })).status).toBe(200);
  });
});

describe('password reset', () => {
  it('does not reveal whether an account exists', async () => {
    const before = mailer.sent.length;
    const res = await client()('POST', '/api/password/forgot', { email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(mailer.sent.length).toBe(before);
  });

  it('resets the password, signs out other sessions, and verifies the email', async () => {
    const { api: oldSession, email } = await account('Pat');
    const stranger = client();
    expect((await stranger('POST', '/api/password/forgot', { email: email.toUpperCase() })).status).toBe(200);
    const token = tokenFrom(email, '/reset');

    expect((await stranger('POST', '/api/password/reset', { token, password: 'short' })).status).toBe(400);
    const reset = await stranger('POST', '/api/password/reset', { token, password: 'brand-new-pass' });
    expect(reset.status).toBe(200);
    expect(reset.body.user).toMatchObject({ email, emailVerified: true });
    expect((await stranger('GET', '/api/me')).body.user.email).toBe(email);

    expect((await oldSession('GET', '/api/me')).body.user).toBeNull();
    expect((await client()('POST', '/api/login', { email, password: 'longenough' })).status).toBe(401);
    expect((await client()('POST', '/api/login', { email, password: 'brand-new-pass' })).status).toBe(200);
    expect((await client()('POST', '/api/password/reset', { token, password: 'another-pass' })).status).toBe(400);
  });
});

describe('tournaments', () => {
  it('stores tournaments per user and keeps other users out', async () => {
    const { api: ana } = await account('Ana');
    const { api: bob } = await account('Bob');

    expect((await ana('PUT', '/api/tournaments/t1', { tournament: tournament() })).status).toBe(201);
    const updated = await ana('PUT', '/api/tournaments/t1', { tournament: tournament('Renamed'), baseVersion: 1 });
    expect(updated.body.tournament).toMatchObject({ name: 'Renamed', version: 2, role: 'owner' });
    expect((await ana('GET', '/api/tournaments')).body.tournaments).toHaveLength(1);
    expect((await bob('GET', '/api/tournaments')).body.tournaments).toHaveLength(0);

    expect((await bob('PUT', '/api/tournaments/t1', { tournament: tournament('Hijack'), baseVersion: 2 })).status).toBe(404);
    expect((await bob('GET', '/api/tournaments/t1')).status).toBe(404);
    expect((await bob('DELETE', '/api/tournaments/t1')).status).toBe(404);
    expect((await ana('PUT', '/api/tournaments/t2', { tournament: { name: 'bad' } })).status).toBe(400);
    expect((await ana('DELETE', '/api/tournaments/t1')).status).toBe(200);
    expect((await ana('GET', '/api/tournaments')).body.tournaments).toHaveLength(0);
  });

  it('rejects stale writes with the latest copy', async () => {
    const { api } = await account('Sam');
    await api('PUT', '/api/tournaments/v1', { tournament: tournament() });
    await api('PUT', '/api/tournaments/v1', { tournament: tournament('Second'), baseVersion: 1 });
    const stale = await api('PUT', '/api/tournaments/v1', { tournament: tournament('Stale'), baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.tournament).toMatchObject({ name: 'Second', version: 2 });
  });

  it('shares a read-only public link that can be revoked', async () => {
    const { api: ana } = await account('Ana');
    await ana('PUT', '/api/tournaments/t3', { tournament: tournament('Open Cup') });
    const { shareId } = (await ana('POST', '/api/tournaments/t3/share', { enabled: true })).body;
    expect(shareId).toBeTruthy();
    expect((await ana('POST', '/api/tournaments/t3/share', { enabled: true })).body.shareId).toBe(shareId);

    const visitor = client();
    const pub = await visitor('GET', `/api/public/${shareId}`);
    expect(pub.body).toMatchObject({ owner: 'Ana', tournament: { name: 'Open Cup' } });

    await ana('POST', '/api/tournaments/t3/share', { enabled: false });
    expect((await visitor('GET', `/api/public/${shareId}`)).status).toBe(404);
  });
});

describe('co-organisers', () => {
  it('invites, accepts, edits, and is removed', async () => {
    const owner = await account('Olga');
    const bob = await account('Bob');
    const carol = await account('Carol', { verified: true });
    await owner.api('PUT', '/api/tournaments/co1', { tournament: tournament('Club Cup') });

    // Unverified owners can't send invitations (stops spam from throwaway accounts).
    expect((await owner.api('POST', '/api/tournaments/co1/invites', { email: bob.email })).status).toBe(403);
    await owner.api('POST', '/api/verify', { token: tokenFrom(owner.email, '/verify') });
    expect((await owner.api('POST', '/api/tournaments/co1/invites', { email: owner.email })).status).toBe(400);
    expect((await owner.api('POST', '/api/tournaments/co1/invites', { email: bob.email.toUpperCase() })).status).toBe(201);
    const token = tokenFrom(bob.email, '/invite');

    expect((await client()('GET', `/api/invites/${token}`)).body).toMatchObject({ tournamentName: 'Club Cup', inviterName: 'Olga', email: bob.email });
    const wrong = await carol.api('POST', '/api/invites/accept', { token });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('wrong_account');

    expect((await bob.api('POST', '/api/invites/accept', { token })).body.tournamentId).toBe('co1');
    expect((await bob.api('GET', '/api/me')).body.user.emailVerified).toBe(true);
    expect((await bob.api('POST', '/api/invites/accept', { token })).status).toBe(404);

    const list = (await bob.api('GET', '/api/tournaments')).body.tournaments;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'co1', role: 'editor', ownerName: 'Olga' });

    expect((await bob.api('PUT', '/api/tournaments/co1', { tournament: tournament('Edited by Bob'), baseVersion: 1 })).status).toBe(200);
    expect((await owner.api('GET', '/api/tournaments/co1')).body.tournament).toMatchObject({ name: 'Edited by Bob', version: 2 });
    expect((await bob.api('POST', '/api/tournaments/co1/share', { enabled: true })).status).toBe(200);
    expect((await bob.api('DELETE', '/api/tournaments/co1')).status).toBe(403);
    expect((await bob.api('POST', '/api/tournaments/co1/invites', { email: 'z@example.com' })).status).toBe(403);
    expect((await owner.api('POST', '/api/tournaments/co1/invites', { email: bob.email })).status).toBe(409);

    const members = (await owner.api('GET', '/api/tournaments/co1/members')).body;
    expect(members.owner.name).toBe('Olga');
    expect(members.members.map((m: { name: string }) => m.name)).toEqual(['Bob']);

    const bobId = (await bob.api('GET', '/api/me')).body.user.id;
    expect((await owner.api('DELETE', `/api/tournaments/co1/members/${bobId}`)).status).toBe(200);
    expect((await bob.api('GET', '/api/tournaments/co1')).status).toBe(404);
  });

  it('lets a co-organiser leave and the owner cancel invitations', async () => {
    const owner = await account('Omar', { verified: true });
    const dan = await account('Dan');
    await owner.api('PUT', '/api/tournaments/co2', { tournament: tournament() });
    await owner.api('POST', '/api/tournaments/co2/invites', { email: 'pending@example.com' });
    const { invites } = (await owner.api('GET', '/api/tournaments/co2/members')).body;
    expect(invites).toHaveLength(1);
    await owner.api('DELETE', `/api/tournaments/co2/invites/${invites[0].id}`);
    expect((await client()('GET', `/api/invites/${tokenFrom('pending@example.com', '/invite')}`)).status).toBe(404);

    await owner.api('POST', '/api/tournaments/co2/invites', { email: dan.email });
    await dan.api('POST', '/api/invites/accept', { token: tokenFrom(dan.email, '/invite') });
    const danId = (await dan.api('GET', '/api/me')).body.user.id;
    expect((await dan.api('DELETE', `/api/tournaments/co2/members/${danId}`)).status).toBe(200);
    expect((await dan.api('GET', '/api/tournaments')).body.tournaments).toHaveLength(0);
  });
});

describe('database', () => {
  it('upgrades a database created before verification and co-organisers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-'));
    const path = join(dir, 'old.db');
    const old = new Database(path);
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE tournaments (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL, share_id TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO users VALUES ('u1', 'old@example.com', 'Old', 'x', 1);
      INSERT INTO tournaments VALUES ('t1', 'u1', '{}', NULL, 1, 1);`);
    old.close();

    const db = openDb(path);
    expect(db.prepare('SELECT version FROM tournaments').get()).toEqual({ version: 1 });
    expect(db.prepare('SELECT email_verified_at FROM users').get()).toEqual({ email_verified_at: null });
    db.close();
    openDb(path).close(); // re-opening is a no-op
    rmSync(dir, { recursive: true });
  });
});

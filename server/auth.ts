import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { DB } from './db';

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const SCRYPT = { N: 16384, r: 8, p: 1 };
export const SESSION_DAYS = 30;
const HOUR = 3_600_000;
export const TOKEN_TTL = { verify: 48 * HOUR, reset: HOUR, invite: 14 * 24 * HOUR };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(key, expected);
}

/** Tokens are only ever stored hashed, so a leaked database can't be used to log in or reset passwords. */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function createSession(db: DB, userId: string): string {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_DAYS * 86_400_000);
  return token;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export function userForToken(db: DB, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.email, u.name, u.email_verified_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).get(sha256(token)) as { id: string; email: string; name: string; email_verified_at: number | null; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(db, token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, emailVerified: row.email_verified_at !== null };
}

export function deleteSession(db: DB, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteAllSessions(db: DB, userId: string) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export type EmailTokenPurpose = 'verify' | 'reset';

/** Issues a fresh single-use token, invalidating earlier unused ones for the same purpose. */
export function createEmailToken(db: DB, userId: string, purpose: EmailTokenPurpose): string {
  const token = newToken();
  db.transaction(() => {
    db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(userId, purpose);
    db.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, purpose, Date.now() + TOKEN_TTL[purpose]);
  })();
  return token;
}

/** Marks the token used and returns its user, or null when it is unknown, expired or already used. */
export function consumeEmailToken(db: DB, token: string, purpose: EmailTokenPurpose): string | null {
  const row = db.prepare(
    `UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
     RETURNING user_id`,
  ).get(Date.now(), sha256(token), purpose, Date.now()) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

/** In-memory fixed-window limiter for abuse-prone actions, keyed by caller. */
export class RateLimiter {
  private hits = new Map<string, { count: number; until: number }>();
  constructor(private max: number, private windowMs: number) {}

  blocked(key: string): boolean {
    const h = this.hits.get(key);
    if (!h) return false;
    if (h.until < Date.now()) {
      this.hits.delete(key);
      return false;
    }
    return h.count >= this.max;
  }

  hit(key: string) {
    const h = this.hits.get(key);
    if (!h || h.until < Date.now()) this.hits.set(key, { count: 1, until: Date.now() + this.windowMs });
    else h.count++;
  }

  /** Records a hit when allowed; returns false (recording nothing) once the caller is over the limit. */
  take(key: string): boolean {
    if (this.blocked(key)) return false;
    this.hit(key);
    return true;
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}

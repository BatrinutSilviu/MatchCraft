import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  RateLimiter, consumeEmailToken, createEmailToken, createSession, deleteAllSessions, deleteSession,
  hashPassword, userForToken, verifyPassword,
} from './auth';
import { emails } from './mailer';
import { COOKIE, EMAIL_RE, link, normEmail, requireUser, sendInBackground, setSessionCookie, userOf, type Ctx } from './http';

const HOUR = 3_600_000;

function checkPassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

export function authRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = Router();
  const auth = requireUser(ctx);
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const forgotByIp = new RateLimiter(10, HOUR);
  const forgotByEmail = new RateLimiter(3, HOUR);
  const resendLimiter = new RateLimiter(3, 10 * 60_000);

  const sendVerification = (user: { id: string; email: string; name: string }) => {
    const token = createEmailToken(db, user.id, 'verify');
    sendInBackground(ctx, emails.verify(user.email, user.name, link(ctx, '/verify', token)));
  };

  // Logged-out visitors get `user: null` rather than a 401, since that is a normal state here.
  r.get('/me', (req, res) => {
    res.json({ user: userForToken(db, req.cookies?.[COOKIE]) });
  });

  r.post('/signup', async (req, res) => {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const name = String(req.body?.name ?? '').trim() || email.split('@')[0];
    if (!EMAIL_RE.test(email) || email.length > 254) return void res.status(400).json({ error: 'Enter a valid email address.' });
    const pwError = checkPassword(password);
    if (pwError) return void res.status(400).json({ error: pwError });
    if (name.length > 100) return void res.status(400).json({ error: 'That name is too long.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return void res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });
    }
    const user = { id: randomUUID(), email, name };
    db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, email, name, await hashPassword(password), Date.now());
    setSessionCookie(ctx, res, createSession(db, user.id));
    sendVerification(user);
    res.status(201).json({ user: { ...user, emailVerified: false } });
  });

  r.post('/login', async (req, res) => {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const key = `${req.ip}|${email}`;
    if (loginLimiter.blocked(key)) return void res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
      { id: string; password_hash: string } | undefined;
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      loginLimiter.hit(key);
      return void res.status(401).json({ error: 'Wrong email or password.' });
    }
    loginLimiter.reset(key);
    const token = createSession(db, row.id);
    setSessionCookie(ctx, res, token);
    res.json({ user: userForToken(db, token) });
  });

  r.post('/logout', (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) deleteSession(db, token);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // --- Email verification ---

  r.post('/verify', (req, res) => {
    const userId = consumeEmailToken(db, String(req.body?.token ?? ''), 'verify');
    if (!userId) {
      return void res.status(400).json({ error: 'This link has expired or was already used. Log in and send a new one.' });
    }
    db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(Date.now(), userId);
    res.json({ ok: true });
  });

  r.post('/verify/resend', auth, (req, res) => {
    const user = userOf(req);
    if (user.emailVerified) return void res.status(400).json({ error: 'Your email is already confirmed.' });
    if (!resendLimiter.take(user.id)) {
      return void res.status(429).json({ error: 'We just sent one. Check your inbox (and spam) or try again in a few minutes.' });
    }
    sendVerification(user);
    res.json({ ok: true });
  });

  // --- Password reset ---

  r.post('/password/forgot', (req, res) => {
    const email = normEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'Enter a valid email address.' });
    if (forgotByIp.blocked(req.ip ?? '')) return void res.status(429).json({ error: 'Too many requests. Try again later.' });
    forgotByIp.hit(req.ip ?? '');
    // Same response whether or not the account exists, so this can't be used to discover who has an account.
    const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email) as
      { id: string; email: string; name: string } | undefined;
    if (user && forgotByEmail.take(email)) {
      const token = createEmailToken(db, user.id, 'reset');
      sendInBackground(ctx, emails.reset(user.email, user.name, link(ctx, '/reset', token)));
    }
    res.json({ ok: true });
  });

  r.post('/password/reset', async (req, res) => {
    const password = String(req.body?.password ?? '');
    const pwError = checkPassword(password);
    if (pwError) return void res.status(400).json({ error: pwError });
    const hash = await hashPassword(password);
    const userId = consumeEmailToken(db, String(req.body?.token ?? ''), 'reset');
    if (!userId) {
      return void res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' });
    }
    db.transaction(() => {
      // Clicking the emailed link proves the address, so it also counts as verification.
      db.prepare('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
        .run(hash, Date.now(), userId);
      deleteAllSessions(db, userId);
    })();
    const token = createSession(db, userId);
    setSessionCookie(ctx, res, token);
    res.json({ user: userForToken(db, token) });
  });

  return r;
}

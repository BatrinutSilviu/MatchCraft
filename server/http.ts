import type { NextFunction, Request, Response } from 'express';
import type { DB } from './db';
import type { Mailer } from './mailer';
import { SESSION_DAYS, userForToken, type SessionUser } from './auth';

export const COOKIE = 'mc_session';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Ctx {
  db: DB;
  mailer: Mailer;
  /** Public base URL used in emailed links, e.g. https://matchcraft.example.com */
  appUrl: string;
  secureCookies?: boolean;
}

export type AuthedRequest = Request & { user: SessionUser };

export const userOf = (req: Request) => (req as AuthedRequest).user;

export function requireUser(ctx: Ctx) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = userForToken(ctx.db, req.cookies?.[COOKIE]);
    if (!user) {
      res.status(401).json({ error: 'Please log in.' });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  };
}

export function setSessionCookie(ctx: Ctx, res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies, path: '/',
    maxAge: SESSION_DAYS * 86_400_000,
  });
}

export const link = (ctx: Ctx, route: string, token: string) =>
  `${ctx.appUrl.replace(/\/$/, '')}/#${route}?token=${encodeURIComponent(token)}`;

/** Send without delaying or failing the response; delivery problems are logged. */
export function sendInBackground(ctx: Ctx, email: Parameters<Mailer['send']>[0]) {
  ctx.mailer.send(email).catch((err) => console.error(`Email to ${email.to} failed:`, err));
}

export const normEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();

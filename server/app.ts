import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import type { DB } from './db';
import { ConsoleMailer, type Mailer } from './mailer';
import type { Ctx } from './http';
import { authRoutes } from './routes-auth';
import { tournamentRoutes } from './routes-tournaments';

interface Options {
  /** Built client to serve in production. */
  staticDir?: string;
  secureCookies?: boolean;
  mailer?: Mailer;
  appUrl?: string;
}

export function createApp(db: DB, opts: Options = {}) {
  const app = express();
  const ctx: Ctx = {
    db,
    mailer: opts.mailer ?? new ConsoleMailer(),
    appUrl: opts.appUrl ?? 'http://localhost:5173',
    secureCookies: opts.secureCookies,
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Mutations must carry a custom header, which cross-site forms cannot send without a CORS preflight.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('X-Matchcraft') !== '1') {
      res.status(403).json({ error: 'Missing request header.' });
      return;
    }
    next();
  });

  app.use('/api', authRoutes(ctx));
  app.use('/api', tournamentRoutes(ctx));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status;
    if (status && status < 500) return void res.status(status).json({ error: 'Bad request.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side.' });
  });

  return app;
}

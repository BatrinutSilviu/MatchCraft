import { resolve } from 'node:path';
import { openDb } from './db';
import { createApp } from './app';
import { ConsoleMailer, SmtpMailer } from './mailer';
import { FakeBilling, StripeBilling, type Billing } from './billing';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3001);
const db = openDb(process.env.DATABASE_PATH ?? resolve('data/matchcraft.db'));

const appUrl = process.env.APP_URL ?? (production ? `http://localhost:${port}` : 'http://localhost:5173');
if (production && !process.env.APP_URL) {
  console.warn(`APP_URL is not set; emailed links will point to ${appUrl}.`);
}

const smtpUrl = process.env.SMTP_URL;
if (production && !smtpUrl) {
  console.warn('SMTP_URL is not set; emails will be printed to this log instead of being sent.');
}
const mailer = smtpUrl
  ? new SmtpMailer(smtpUrl, process.env.MAIL_FROM ?? 'Matchcraft <no-reply@localhost>')
  : new ConsoleMailer();

/**
 * Billing is off unless configured, which unlocks everything (fine for self-hosting).
 * BILLING=fake lets you click through upgrades locally without a Stripe account.
 */
function billingFromEnv(): Billing | null {
  const env = process.env;
  if (env.STRIPE_SECRET_KEY) {
    const missing = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_EVENT', 'STRIPE_PRICE_CLUB'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`STRIPE_SECRET_KEY is set but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing.`);
    return new StripeBilling(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET!, {
      event: env.STRIPE_PRICE_EVENT!, club: env.STRIPE_PRICE_CLUB!,
    });
  }
  if (env.BILLING === 'fake') {
    if (production) throw new Error('BILLING=fake is for local development only.');
    return new FakeBilling(appUrl.replace(/\/$/, ''));
  }
  return null;
}

const app = createApp(db, {
  billing: billingFromEnv(),
  prices: { event: process.env.PRICE_LABEL_EVENT ?? '€19', club: process.env.PRICE_LABEL_CLUB ?? '€29 / month' },
  freeParticipantLimit: Number(process.env.FREE_PARTICIPANT_LIMIT ?? 16),
  staticDir: production ? resolve('dist') : undefined,
  secureCookies: process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === 'true' : production,
  mailer,
  appUrl,
});

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.listen(port, () => {
  console.log(`Matchcraft API listening on http://localhost:${port}`);
});

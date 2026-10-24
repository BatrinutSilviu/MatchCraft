import { resolve } from 'node:path';
import { openDb } from './db';
import { createApp } from './app';
import { ConsoleMailer, SmtpMailer } from './mailer';

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

const app = createApp(db, {
  staticDir: production ? resolve('dist') : undefined,
  secureCookies: process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === 'true' : production,
  mailer,
  appUrl,
});

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.listen(port, () => {
  console.log(`Matchcraft API listening on http://localhost:${port}`);
});

# Matchcraft

Create and run a tournament or single match for any sport: pick a sport, choose a format, tweak the rules, enter scores, and share a live read-only link.

## Develop

```bash
npm install
npm run dev      # API on :3001 + web app on :5173 (proxies /api)
npm test         # engine + API tests
```

## Run in production

```bash
npm run build
npm start        # serves the app and API on $PORT (default 3001)
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `DATABASE_PATH` | `data/matchcraft.db` | SQLite file; back it up, it holds all accounts and tournaments |
| `SECURE_COOKIES` | `true` in production | Set `false` only when serving over plain HTTP |
| `TRUST_PROXY` | unset | Set (e.g. `1`) behind a reverse proxy so login rate limiting sees real client IPs |
| `APP_URL` | `http://localhost:5173` in dev | Public address of the site, used in emailed links (e.g. `https://matchcraft.example.com`) |
| `SMTP_URL` | unset | Email server, e.g. `smtps://user:pass@smtp.resend.com:465`. When unset, emails are printed to the server log instead |
| `MAIL_FROM` | `Matchcraft <no-reply@localhost>` | Sender shown on emails; use an address your provider has verified |

| `FREE_PARTICIPANT_LIMIT` | `16` | Most entries a free tournament can have while billing is on |
| `BILLING` | unset | `fake` lets you click through upgrades locally without paying (refused in production) |
| `STRIPE_SECRET_KEY` | unset | Turns on real billing. Also needs `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_EVENT` (one-off price) and `STRIPE_PRICE_CLUB` (recurring price) |
| `PRICE_LABEL_EVENT` / `PRICE_LABEL_CLUB` | `€19` / `€29 / month` | Prices shown on upgrade buttons; keep them in line with your Stripe prices |

## Plans and billing

With no billing configured, every feature is unlocked, which suits self-hosting. Once billing is on:

- **Free:** unlimited tournaments, up to `FREE_PARTICIPANT_LIMIT` entries each, a "Made with Matchcraft" footer on public pages.
- **Event pass (Pro, one-off):** unlocks one tournament: more entries, logo and colour, sponsor logos, no footer.
- **Club (subscription):** every tournament the user owns is Pro.

Limits are checked only when something changes, so a tournament never breaks if a plan lapses. Point a Stripe webhook at `https://<your site>/api/billing/webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated` and `customer.subscription.deleted`. Subscribers manage or cancel their plan from **Plan & billing** (Stripe customer portal; enable it in the Stripe dashboard).

## Sign-ups, scheduling and TV mode

- **Sign-ups:** in the wizard, tick "Let teams sign up through a link". The share link becomes a sign-up form. Entries are accepted up to the limit, later ones join a waitlist, and contact emails are visible only to organisers. Press **Generate fixtures** when you're ready; you can still change the format before then.
- **Schedule:** in **Settings → Schedule**, set a start time, how many courts/pitches/tables are in use, match length and changeover. Every match gets a time and a place; knockout matches wait for their feeder matches, and nobody is booked twice at once. New Swiss rounds are slotted in automatically.
- **Live updates:** organiser pages, public pages and TV screens update the moment anything changes (Server-Sent Events). Behind nginx, `X-Accel-Buffering: no` is already sent; make sure `proxy_read_timeout` is longer than 30 s.
- **TV mode:** `#/tv/<share id>` (or **Share → Open TV mode**) cycles through upcoming matches, results, tables and the bracket. Double-click for full screen.

## Accounts and email

- New accounts get a confirmation email. Until it's confirmed, the app shows a reminder banner, and the user can't invite co-organisers.
- **Forgot password** sends a one-hour, single-use reset link. Resetting signs the user out on every other device.
- **Co-organisers:** the owner invites people by email from **Settings → Organisers**. Invitees accept with an account on that same email address, then can enter scores and change settings. Only the owner can invite, remove people or delete the tournament. If two organisers save at the same moment, the second change is applied on top of the first instead of overwriting it.
- During development, emails are printed in the `npm run dev` terminal. Copy a link from there to click through the flows.

## Layout

- `src/engine/`: fixtures, brackets, standings, Swiss pairing, and result validation (pure and tested)
- `src/components/`: React screens
- `server/`: Express API, SQLite schema, and email/password auth (scrypt hashes, httpOnly session cookies)

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

## Accounts and email

- New accounts get a confirmation email. Until it's confirmed, the app shows a reminder banner, and the user can't invite co-organisers.
- **Forgot password** sends a one-hour, single-use reset link. Resetting signs the user out on every other device.
- **Co-organisers:** the owner invites people by email from **Settings → Organisers**. Invitees accept with an account on that same email address, then can enter scores and change settings. Only the owner can invite, remove people or delete the tournament. If two organisers save at the same moment, the second change is applied on top of the first instead of overwriting it.
- During development, emails are printed in the `npm run dev` terminal. Copy a link from there to click through the flows.

## Layout

- `src/engine/`: fixtures, brackets, standings, Swiss pairing, and result validation (pure and tested)
- `src/components/`: React screens
- `server/`: Express API, SQLite schema, and email/password auth (scrypt hashes, httpOnly session cookies)

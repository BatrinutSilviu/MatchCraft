import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { RateLimiter } from './auth';
import { emails } from './mailer';
import { EMAIL_RE, normEmail, requireUser, sendInBackground, userOf, type Ctx } from './http';
import { isPro } from './plan';

interface Participant {
  id: string;
  name: string;
  seed: number;
}

interface Registration {
  id: string;
  participantId: string;
  name: string;
  email: string;
  note: string | null;
  createdAt: number;
}

/**
 * Self-registration: while a tournament is in its setup phase with sign-ups open, anyone with the
 * share link can enter. Entries go straight into the participant list until it is full; later ones wait.
 */
export function registrationRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = Router();
  const byIp = new RateLimiter(20, 3_600_000);

  r.post('/public/:shareId/register', (req, res) => {
    const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
    const email = normEmail(req.body?.email);
    const note = String(req.body?.note ?? '').trim().slice(0, 300) || null;
    if (!name || name.length > 60) return void res.status(400).json({ error: 'Enter a name of up to 60 characters.' });
    if (!EMAIL_RE.test(email) || email.length > 254) return void res.status(400).json({ error: 'Enter a valid email address.' });
    if (!byIp.take(req.ip ?? 'unknown')) return void res.status(429).json({ error: 'Too many sign-ups from here. Try again later.' });

    // One transaction, so two people taking the last spot at once can't both get it.
    const outcome = db.transaction(() => {
      const row = db.prepare(
        `SELECT t.id, t.data, t.plan, u.plan AS owner_plan FROM tournaments t JOIN users u ON u.id = t.owner_id WHERE t.share_id = ?`,
      ).get(req.params.shareId) as { id: string; data: string; plan: string; owner_plan: string } | undefined;
      if (!row) return { status: 404, error: 'This link doesn’t work anymore.' } as const;
      const t = JSON.parse(row.data);
      if (t.phase !== 'setup' || !t.registration?.open) return { status: 409, error: 'Sign-ups for this tournament are closed.' } as const;

      const participants = (t.participants ?? []) as Participant[];
      const taken = db.prepare('SELECT name, email FROM registrations WHERE tournament_id = ?').all(row.id) as { name: string; email: string }[];
      if (taken.some((x) => x.email.toLowerCase() === email)) {
        return { status: 409, error: 'This email address is already signed up.' } as const;
      }
      const lower = name.toLowerCase();
      if (participants.some((p) => p.name.toLowerCase() === lower) || taken.some((x) => x.name.toLowerCase() === lower)) {
        return { status: 409, error: `“${name}” is already taken. Add something to tell them apart.` } as const;
      }

      const wanted = Number(t.registration.capacity) || Infinity;
      const capacity = isPro(ctx, row) ? wanted : Math.min(wanted, ctx.freeParticipantLimit);
      const participantId = randomBytes(6).toString('hex');
      const entered = participants.length < capacity;
      db.prepare(
        'INSERT INTO registrations (id, tournament_id, participant_id, name, email, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), row.id, participantId, name, email, note, Date.now());
      if (entered) {
        const next = { ...t, participants: [...participants, { id: participantId, name, seed: participants.length + 1 }], updatedAt: Date.now() };
        db.prepare('UPDATE tournaments SET data = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(JSON.stringify(next), Date.now(), row.id);
      }
      const { version } = db.prepare('SELECT version FROM tournaments WHERE id = ?').get(row.id) as { version: number };
      return { status: 201, id: row.id, version, entered, tournamentName: String(t.name) } as const;
    })();

    if ('error' in outcome) return void res.status(outcome.status).json({ error: outcome.error });
    ctx.live.publish(outcome.id, { version: outcome.version });
    const url = `${ctx.appUrl.replace(/\/$/, '')}/#/s/${req.params.shareId}`;
    sendInBackground(ctx, emails.registered(email, name, outcome.tournamentName, url, outcome.entered));
    res.status(201).json({ status: outcome.entered ? 'entered' : 'waitlist' });
  });

  r.get('/tournaments/:id/registrations', requireUser(ctx), (req, res) => {
    if (!canManage(ctx, req.params.id, userOf(req).id)) return void res.status(404).json({ error: 'Tournament not found.' });
    const list = db.prepare(
      `SELECT id, participant_id AS participantId, name, email, note, created_at AS createdAt
       FROM registrations WHERE tournament_id = ? ORDER BY created_at`,
    ).all(req.params.id) as Registration[];
    res.json({ registrations: list });
  });

  /** Forgets a sign-up. The client removes the matching participant itself, as an ordinary edit. */
  r.delete('/tournaments/:id/registrations/:regId', requireUser(ctx), (req, res) => {
    if (!canManage(ctx, req.params.id, userOf(req).id)) return void res.status(404).json({ error: 'Tournament not found.' });
    db.prepare('DELETE FROM registrations WHERE id = ? AND tournament_id = ?').run(req.params.regId, req.params.id);
    res.json({ ok: true });
  });

  return r;
}

function canManage(ctx: Ctx, tournamentId: string, userId: string): boolean {
  return Boolean(ctx.db.prepare(
    `SELECT 1 FROM tournaments WHERE id = @t AND (owner_id = @u
       OR id IN (SELECT tournament_id FROM tournament_members WHERE user_id = @u))`,
  ).get({ t: tournamentId, u: userId }));
}

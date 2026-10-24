import { Router, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { RateLimiter, TOKEN_TTL, newToken, sha256 } from './auth';
import { emails } from './mailer';
import { EMAIL_RE, link, normEmail, requireUser, userOf, type Ctx } from './http';

type Role = 'owner' | 'editor';

interface TournamentRow {
  id: string;
  data: string;
  share_id: string | null;
  version: number;
  owner_name: string;
  role: Role;
}

const SELECT_FOR_USER = `
  SELECT t.id, t.data, t.share_id, t.version, u.name AS owner_name,
         CASE WHEN t.owner_id = @user THEN 'owner' ELSE 'editor' END AS role
  FROM tournaments t JOIN users u ON u.id = t.owner_id
  WHERE (t.owner_id = @user OR t.id IN (SELECT tournament_id FROM tournament_members WHERE user_id = @user))`;

function serialize(row: TournamentRow) {
  return {
    ...JSON.parse(row.data), id: row.id, shareId: row.share_id ?? undefined,
    version: row.version, role: row.role, ownerName: row.owner_name,
  };
}

/** Minimal shape check; the client engine owns the detailed structure. */
function validTournament(body: unknown): body is Record<string, unknown> {
  if (!body || typeof body !== 'object') return false;
  const t = body as Record<string, unknown>;
  return typeof t.name === 'string' && t.name.length <= 200
    && Array.isArray(t.participants) && t.participants.length <= 1024
    && Array.isArray(t.matches)
    && typeof t.rules === 'object' && t.rules !== null
    && typeof t.format === 'object' && t.format !== null;
}

/** Fields the server owns; never stored from client input. */
const SERVER_FIELDS = ['shareId', 'version', 'role', 'ownerName'];

export function tournamentRoutes(ctx: Ctx) {
  const { db } = ctx;
  const r = Router();
  const inviteLimiter = new RateLimiter(20, 3_600_000);
  r.use('/tournaments', requireUser(ctx));

  const load = (id: string, userId: string) =>
    db.prepare(`${SELECT_FOR_USER} AND t.id = @id`).get({ user: userId, id }) as TournamentRow | undefined;

  const notFound = (res: Response) => res.status(404).json({ error: 'Tournament not found.' });
  const ownerOnly = (res: Response, what: string) => res.status(403).json({ error: `Only the owner can ${what}.` });

  r.get('/tournaments', (req, res) => {
    const rows = db.prepare(`${SELECT_FOR_USER} ORDER BY t.updated_at DESC`).all({ user: userOf(req).id }) as TournamentRow[];
    res.json({ tournaments: rows.map(serialize) });
  });

  r.get('/tournaments/:id', (req, res) => {
    const row = load(req.params.id, userOf(req).id);
    if (!row) return void notFound(res);
    res.json({ tournament: serialize(row) });
  });

  /**
   * Create or update. Updates must send the `baseVersion` they were made from; if another
   * organiser saved in between, the server answers 409 with the latest copy so the client can re-apply.
   */
  r.put('/tournaments/:id', (req, res) => {
    const user = userOf(req);
    const id = req.params.id;
    const body = req.body?.tournament;
    if (id.length > 64 || !validTournament(body)) return void res.status(400).json({ error: 'Invalid tournament.' });
    const data = JSON.stringify({ ...Object.fromEntries(Object.entries(body).filter(([k]) => !SERVER_FIELDS.includes(k))), id });
    const now = Date.now();

    const exists = db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id);
    if (!exists) {
      db.prepare('INSERT INTO tournaments (id, owner_id, data, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)')
        .run(id, user.id, data, now, now);
      return void res.status(201).json({ tournament: serialize(load(id, user.id)!) });
    }

    const row = load(id, user.id);
    if (!row) return void notFound(res);
    const result = db.prepare('UPDATE tournaments SET data = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
      .run(data, now, id, Number(req.body?.baseVersion));
    if (!result.changes) {
      return void res.status(409).json({ error: 'Someone else updated this tournament.', tournament: serialize(load(id, user.id)!) });
    }
    res.json({ tournament: serialize(load(id, user.id)!) });
  });

  r.delete('/tournaments/:id', (req, res) => {
    const row = load(req.params.id, userOf(req).id);
    if (!row) return void notFound(res);
    if (row.role !== 'owner') return void ownerOnly(res, 'delete this tournament');
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  r.post('/tournaments/:id/share', (req, res) => {
    const row = load(req.params.id, userOf(req).id);
    if (!row) return void notFound(res);
    const enabled = Boolean(req.body?.enabled);
    db.prepare(`UPDATE tournaments SET share_id = CASE WHEN ? THEN COALESCE(share_id, ?) ELSE NULL END WHERE id = ?`)
      .run(enabled ? 1 : 0, randomBytes(9).toString('base64url'), row.id);
    const { share_id } = db.prepare('SELECT share_id FROM tournaments WHERE id = ?').get(row.id) as { share_id: string | null };
    res.json({ shareId: share_id });
  });

  // --- Co-organisers ---

  r.get('/tournaments/:id/members', (req, res) => {
    const row = load(req.params.id, userOf(req).id);
    if (!row) return void notFound(res);
    const owner = db.prepare('SELECT u.id, u.name, u.email FROM tournaments t JOIN users u ON u.id = t.owner_id WHERE t.id = ?').get(row.id);
    const members = db.prepare(
      `SELECT u.id, u.name, u.email, m.added_at AS addedAt FROM tournament_members m JOIN users u ON u.id = m.user_id
       WHERE m.tournament_id = ? ORDER BY m.added_at`,
    ).all(row.id);
    const invites = db.prepare(
      `SELECT id, email, created_at AS createdAt, expires_at AS expiresAt FROM invites
       WHERE tournament_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at`,
    ).all(row.id, Date.now());
    res.json({ owner, members, invites });
  });

  r.post('/tournaments/:id/invites', async (req, res) => {
    const user = userOf(req);
    const row = load(req.params.id, user.id);
    if (!row) return void notFound(res);
    if (row.role !== 'owner') return void ownerOnly(res, 'invite co-organisers');
    if (!user.emailVerified) return void res.status(403).json({ error: 'Confirm your own email address before inviting others.' });
    const email = normEmail(req.body?.email);
    if (!EMAIL_RE.test(email) || email.length > 254) return void res.status(400).json({ error: 'Enter a valid email address.' });
    if (email === user.email.toLowerCase()) return void res.status(400).json({ error: 'You already own this tournament.' });
    const already = db.prepare(
      `SELECT 1 FROM tournament_members m JOIN users u ON u.id = m.user_id WHERE m.tournament_id = ? AND u.email = ?`,
    ).get(row.id, email);
    if (already) return void res.status(409).json({ error: 'That person is already a co-organiser.' });
    if (!inviteLimiter.take(user.id)) return void res.status(429).json({ error: 'You’ve sent a lot of invitations. Try again later.' });

    const token = newToken();
    const invite = { id: randomUUID(), email, createdAt: Date.now(), expiresAt: Date.now() + TOKEN_TTL.invite };
    db.transaction(() => {
      // Re-inviting the same address replaces the old link.
      db.prepare('DELETE FROM invites WHERE tournament_id = ? AND email = ? AND accepted_at IS NULL').run(row.id, email);
      db.prepare(
        'INSERT INTO invites (id, tournament_id, email, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(invite.id, row.id, email, sha256(token), user.id, invite.createdAt, invite.expiresAt);
    })();

    const name = JSON.parse(row.data).name as string;
    try {
      await ctx.mailer.send(emails.invite(email, user.name, name, link(ctx, '/invite', token)));
    } catch (err) {
      console.error('Invite email failed:', err);
      db.prepare('DELETE FROM invites WHERE id = ?').run(invite.id);
      return void res.status(502).json({ error: 'We couldn’t send the invitation email. Please try again.' });
    }
    res.status(201).json({ invite });
  });

  r.delete('/tournaments/:id/invites/:inviteId', (req, res) => {
    const row = load(req.params.id, userOf(req).id);
    if (!row) return void notFound(res);
    if (row.role !== 'owner') return void ownerOnly(res, 'cancel invitations');
    db.prepare('DELETE FROM invites WHERE id = ? AND tournament_id = ?').run(req.params.inviteId, row.id);
    res.json({ ok: true });
  });

  /** The owner removes a co-organiser, or a co-organiser leaves. */
  r.delete('/tournaments/:id/members/:userId', (req, res) => {
    const user = userOf(req);
    const row = load(req.params.id, user.id);
    if (!row) return void notFound(res);
    if (row.role !== 'owner' && req.params.userId !== user.id) return void ownerOnly(res, 'remove co-organisers');
    db.prepare('DELETE FROM tournament_members WHERE tournament_id = ? AND user_id = ?').run(row.id, req.params.userId);
    res.json({ ok: true });
  });

  // --- Accepting invitations ---

  const findInvite = (token: string) => db.prepare(
    `SELECT i.id, i.tournament_id, i.email, t.data, u.name AS inviter FROM invites i
     JOIN tournaments t ON t.id = i.tournament_id JOIN users u ON u.id = i.invited_by
     WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`,
  ).get(sha256(token), Date.now()) as { id: string; tournament_id: string; email: string; data: string; inviter: string } | undefined;

  const goneMessage = 'This invitation has expired, was cancelled, or was already used. Ask the organiser for a new one.';

  r.get('/invites/:token', (req, res) => {
    const invite = findInvite(req.params.token);
    if (!invite) return void res.status(404).json({ error: goneMessage });
    res.json({ tournamentName: JSON.parse(invite.data).name, inviterName: invite.inviter, email: invite.email });
  });

  r.post('/invites/accept', requireUser(ctx), (req, res) => {
    const user = userOf(req);
    const invite = findInvite(String(req.body?.token ?? ''));
    if (!invite) return void res.status(404).json({ error: goneMessage });
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return void res.status(403).json({
        error: `This invitation was sent to ${invite.email}. Log in with that account to accept it.`,
        code: 'wrong_account',
      });
    }
    db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO tournament_members (tournament_id, user_id, role, added_at)
         SELECT ?, ?, 'editor', ? WHERE NOT EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND owner_id = ?)`,
      ).run(invite.tournament_id, user.id, Date.now(), invite.tournament_id, user.id);
      db.prepare('UPDATE invites SET accepted_at = ? WHERE id = ?').run(Date.now(), invite.id);
      // The invite reached this inbox, which proves the address.
      db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(Date.now(), user.id);
    })();
    res.json({ tournamentId: invite.tournament_id });
  });

  r.get('/public/:shareId', (req, res) => {
    const row = db.prepare(
      `SELECT t.id, t.data, u.name AS owner FROM tournaments t JOIN users u ON u.id = t.owner_id WHERE t.share_id = ?`,
    ).get(req.params.shareId) as { id: string; data: string; owner: string } | undefined;
    if (!row) return void res.status(404).json({ error: 'This link doesn’t work anymore.' });
    res.json({ tournament: { ...JSON.parse(row.data), id: row.id }, owner: row.owner });
  });

  return r;
}

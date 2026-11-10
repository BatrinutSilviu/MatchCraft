import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

/** Each entry upgrades the schema by one version; never edit a migration once shipped. */
const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    share_id TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tournaments_owner ON tournaments(owner_id, updated_at DESC);
  `,
  `
  ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
  ALTER TABLE tournaments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

  -- Single-use links sent by email: account verification and password reset.
  CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

  CREATE TABLE tournament_members (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor',
    added_at INTEGER NOT NULL,
    PRIMARY KEY (tournament_id, user_id)
  );
  CREATE INDEX tournament_members_user ON tournament_members(user_id);

  CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    token_hash TEXT NOT NULL UNIQUE,
    invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    accepted_at INTEGER
  );
  CREATE INDEX invites_tournament ON invites(tournament_id);
  `,
  `
  -- Paid plans: 'pro' on a tournament (event pass) or 'club' on a user (subscription, covers all they own).
  ALTER TABLE tournaments ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
  ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
  ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
  ALTER TABLE users ADD COLUMN subscription_id TEXT;

  CREATE TABLE payments (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('event', 'club')),
    tournament_id TEXT,
    paid_at INTEGER,
    created_at INTEGER NOT NULL
  );

  -- Public sign-ups. The contact email stays here, never in the tournament data that spectators can read.
  CREATE TABLE registrations (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX registrations_tournament ON registrations(tournament_id, created_at);
  `,
];

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

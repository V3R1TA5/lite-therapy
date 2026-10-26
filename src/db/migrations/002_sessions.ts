import type { DatabaseConnection } from '../database.js';

export const migration002 = {
  version: 2,
  name: 'sessions',
  up(db: DatabaseConnection): void {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'ended')),
        counselor_id TEXT NOT NULL DEFAULT 'zhiwei',
        started_at TEXT NOT NULL,
        resumed_at TEXT NOT NULL,
        ended_at TEXT,
        prompt_snapshot_json TEXT,
        memory_snapshot_json TEXT,
        risk_state TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX sessions_status_updated ON sessions(status, updated_at DESC);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted', 'failed')),
        token_estimate INTEGER NOT NULL DEFAULT 0,
        risk_level TEXT NOT NULL DEFAULT 'none',
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX messages_session_order ON messages(session_id, created_at);

      CREATE TABLE model_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        task TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cost_estimate REAL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX model_usage_session_order ON model_usage(session_id, created_at);

      CREATE TRIGGER sessions_single_open_insert
      BEFORE INSERT ON sessions
      WHEN NEW.status IN ('draft', 'active')
        AND EXISTS (SELECT 1 FROM sessions WHERE status IN ('draft', 'active'))
      BEGIN
        SELECT RAISE(ABORT, 'only one open session is allowed');
      END;

      CREATE TRIGGER sessions_single_open_update
      BEFORE UPDATE OF status ON sessions
      WHEN NEW.status IN ('draft', 'active')
        AND EXISTS (
          SELECT 1 FROM sessions WHERE id <> NEW.id AND status IN ('draft', 'active')
        )
      BEGIN
        SELECT RAISE(ABORT, 'only one open session is allowed');
      END;
    `);
  },
};

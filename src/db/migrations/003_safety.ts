import type { DatabaseConnection } from '../database.js';

export const migration003 = {
  version: 3,
  name: 'safety',
  up(db: DatabaseConnection): void {
    db.exec(`
      CREATE TABLE risk_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        level TEXT NOT NULL CHECK (level IN ('none', 'concern', 'imminent')),
        detector TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX risk_events_session_order ON risk_events(session_id, created_at);

      CREATE TABLE rolling_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        covered_until_message_id TEXT,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX rolling_summaries_session_order ON rolling_summaries(session_id, created_at);

      CREATE TABLE context_audits (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        message_id TEXT,
        prompt_tokens INTEGER NOT NULL,
        history_tokens INTEGER NOT NULL,
        history_messages INTEGER NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0,
        summary_used INTEGER NOT NULL DEFAULT 0,
        memo_used INTEGER NOT NULL DEFAULT 0,
        memory_used INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX context_audits_session_order ON context_audits(session_id, created_at);
    `);
  },
};

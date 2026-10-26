import type { DatabaseConnection } from '../database.js';

export const migration005 = {
  version: 5,
  name: 'post_session',
  up(db: DatabaseConnection): void {
    db.exec(`
      CREATE TABLE session_notes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        source_ended_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, source_ended_at)
      ) STRICT;

      CREATE TABLE case_formulations (
        id TEXT PRIMARY KEY,
        counselor_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        covered_session_ids_json TEXT NOT NULL DEFAULT '[]',
        model TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE supervisions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        source_ended_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, source_ended_at)
      ) STRICT;

      CREATE TABLE memos (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        counselor_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ready', 'invalid', 'archived')),
        model TEXT NOT NULL,
        source_ended_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX memos_ready_unique
        ON memos(session_id, source_ended_at)
        WHERE status = 'ready';

      CREATE TABLE letters (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        source_ended_at TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, source_ended_at)
      ) STRICT;

      CREATE TABLE post_session_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (
          kind IN ('session_note', 'case_formulation', 'supervision', 'memo', 'letter', 'memory')
        ),
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'running', 'ready', 'failed', 'stale', 'skipped')
        ),
        attempts INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL,
        error TEXT,
        source_ended_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, kind, source_ended_at)
      ) STRICT;

      CREATE INDEX post_session_jobs_session_order
        ON post_session_jobs(session_id, created_at);
      CREATE INDEX session_notes_session_order
        ON session_notes(session_id, created_at);
      CREATE INDEX memos_session_order
        ON memos(session_id, created_at);
      CREATE INDEX letters_session_order
        ON letters(created_at);
    `);
  },
};

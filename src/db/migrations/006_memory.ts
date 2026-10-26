import type { DatabaseConnection } from '../database.js';

export const migration006 = {
  version: 6,
  name: 'memory',
  up(db: DatabaseConnection): void {
    db.exec(`
      CREATE TABLE memory_cards (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (
          kind IN ('fact', 'theme', 'relationship', 'preference', 'risk_resource', 'unfinished')
        ),
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        source_message_ids_json TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'sensitive', 'restricted')),
        tags_json TEXT NOT NULL DEFAULT '[]',
        embedding BLOB,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'deleted')),
        uncertain INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_recalled_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE INDEX memory_cards_status_kind ON memory_cards(status, kind, created_at);
      CREATE INDEX memory_cards_hash ON memory_cards(text_hash);

      CREATE TABLE memory_recalls (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        message_id TEXT,
        memory_id TEXT NOT NULL REFERENCES memory_cards(id) ON DELETE CASCADE,
        score REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX memory_recalls_session_order ON memory_recalls(session_id, created_at);

      CREATE VIRTUAL TABLE memory_cards_fts USING fts5(
        text,
        tags,
        memory_id UNINDEXED,
        tokenize = 'trigram'
      );
    `);
  },
};

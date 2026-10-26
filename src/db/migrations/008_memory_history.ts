import type { DatabaseConnection } from '../database.js';

export const migration008 = {
  version: 8,
  name: 'memory_history',
  up(db: DatabaseConnection): void {
    db.exec(`
      CREATE TABLE memory_card_revisions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        previous_text TEXT NOT NULL,
        new_text TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memory_cards(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX idx_memory_card_revisions_memory
        ON memory_card_revisions(memory_id, changed_at DESC);
    `);
  },
};

import type { DatabaseConnection } from '../database.js';

export const migration007 = {
  version: 7,
  name: 'session_memory_switch',
  up(db: DatabaseConnection): void {
    db.exec(`
      ALTER TABLE sessions
      ADD COLUMN memory_recall_enabled INTEGER NOT NULL DEFAULT 1;
    `);
  },
};

import type { DatabaseConnection } from '../database.js';

export const migration001 = {
  version: 1,
  name: 'init',
  up(db: DatabaseConnection): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        display_name TEXT NOT NULL DEFAULT '',
        locale TEXT NOT NULL,
        timezone TEXT NOT NULL,
        age_band TEXT NOT NULL DEFAULT 'unspecified',
        preferences_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO app_meta (key, value) VALUES ('schema_generation', '1')
        ON CONFLICT(key) DO NOTHING;
    `);
  },
};

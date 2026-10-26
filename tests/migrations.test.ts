import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDatabase } from '../src/db/backup.js';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { migration001 } from '../src/db/migrations/001_init.js';
import { type Migration, runMigrations } from '../src/db/migrations/index.js';
import { getProfile, saveProfile } from '../src/db/repositories/profileRepository.js';

const roots: string[] = [];
const KEY = Buffer.alloc(32, 7);

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-migrations-'));
  roots.push(root);
  return root;
}

function tableNames(db: DatabaseConnection): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('migrations', () => {
  it('applies the initial schema and is idempotent', async () => {
    const dir = tempDir();
    const db = openEncryptedDatabase(join(dir, 'counsel.db'), KEY);
    try {
      const first = await runMigrations(db);
      expect(first.applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const tables = tableNames(db);
      expect(tables).toContain('schema_migrations');
      expect(tables).toContain('profile');
      expect(tables).toContain('settings');
      expect(tables).toContain('app_meta');
      expect(tables).toContain('sessions');
      expect(tables).toContain('messages');
      expect(tables).toContain('model_usage');
      expect(tables).toContain('risk_events');
      expect(tables).toContain('rolling_summaries');
      expect(tables).toContain('context_audits');
      expect(tables).toContain('post_session_jobs');
      expect(tables).toContain('session_notes');
      expect(tables).toContain('memos');
      expect(tables).toContain('letters');
      expect(tables).toContain('memory_cards');
      expect(tables).toContain('memory_recalls');
      expect(tables).toContain('memory_card_revisions');
      const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{
        name: string;
      }>;
      expect(sessionColumns.map((column) => column.name)).toContain('memory_recall_enabled');
      const auditColumns = db.prepare('PRAGMA table_info(context_audits)').all() as Array<{
        name: string;
      }>;
      expect(auditColumns.map((column) => column.name)).toContain('entries_json');

      saveProfile(db, {
        displayName: '小林',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      });
      expect(getProfile(db)?.displayName).toBe('小林');

      const second = await runMigrations(db);
      expect(second.applied).toEqual([]);
      expect(second.alreadyApplied).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      db.close();
    }
  });

  it('backs up an existing database before applying a new migration', async () => {
    const dir = tempDir();
    const db = openEncryptedDatabase(join(dir, 'counsel.db'), KEY);
    try {
      await runMigrations(db, { migrations: [migration001] });

      const migration2: Migration = {
        version: 2,
        name: 'add_probe',
        up(database) {
          database.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY) STRICT');
        },
      };

      let backupPath = '';
      const result = await runMigrations(db, {
        migrations: [migration001, migration2],
        backup: async () => {
          backupPath = await backupDatabase(db, join(dir, 'backups'), {
            now: new Date('2026-10-26T00:00:00.000Z'),
          });
        },
      });

      expect(result.applied).toEqual([2]);
      expect(existsSync(backupPath)).toBe(true);

      const backup = openEncryptedDatabase(backupPath, KEY);
      try {
        const row = backup
          .prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'profile'",
          )
          .get() as { n: number };
        expect(row.n).toBe(1);
      } finally {
        backup.close();
      }
    } finally {
      db.close();
    }
  });

  it('rolls back a failing migration and keeps it unapplied', async () => {
    const dir = tempDir();
    const db = openEncryptedDatabase(join(dir, 'counsel.db'), KEY);
    try {
      await runMigrations(db, { migrations: [migration001] });

      const broken: Migration = {
        version: 2,
        name: 'broken',
        up(database) {
          database.exec('CREATE TABLE broken_probe (id INTEGER) STRICT');
          throw new Error('boom');
        },
      };

      await expect(runMigrations(db, { migrations: [migration001, broken] })).rejects.toThrow(
        'boom',
      );

      expect(tableNames(db)).not.toContain('broken_probe');
      const applied = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
        version: number;
      }>;
      expect(applied.map((row) => row.version)).not.toContain(2);
    } finally {
      db.close();
    }
  });
});

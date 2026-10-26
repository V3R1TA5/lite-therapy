import type { DatabaseConnection } from '../database.js';
import { migration001 } from './001_init.js';
import { migration002 } from './002_sessions.js';
import { migration003 } from './003_safety.js';
import { migration004 } from './004_context_audit_entries.js';
import { migration005 } from './005_post_session.js';
import { migration006 } from './006_memory.js';
import { migration007 } from './007_session_memory_switch.js';
import { migration008 } from './008_memory_history.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseConnection) => void;
}

export interface MigrationResult {
  applied: number[];
  alreadyApplied: number[];
}

export interface RunMigrationsOptions {
  migrations?: Migration[];
  /** 已有数据时的迁移前备份；首次建库不触发。 */
  backup?: () => Promise<void>;
  now?: () => Date;
}

export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
];

function assertValidMigrations(migrations: Migration[]): void {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error('迁移版本号必须是正整数。');
    }
    if (seen.has(migration.version)) {
      throw new Error('迁移版本号重复：' + migration.version);
    }
    seen.add(migration.version);
    if (migration.name.trim().length === 0) {
      throw new Error('迁移名称不能为空。');
    }
  }
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT
`;

export async function runMigrations(
  db: DatabaseConnection,
  options: RunMigrationsOptions = {},
): Promise<MigrationResult> {
  const migrations = [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  assertValidMigrations(migrations);

  db.exec(MIGRATIONS_TABLE);
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
    version: number;
  }>;
  const appliedVersions = new Set(rows.map((row) => row.version));
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));

  if (pending.length === 0) {
    return { applied: [], alreadyApplied: [...appliedVersions].sort((a, b) => a - b) };
  }

  if (options.backup && rows.length > 0) {
    await options.backup();
  }

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  const clock = options.now ?? (() => new Date());
  const applied: number[] = [];

  for (const migration of pending) {
    const transaction = db.transaction(() => {
      migration.up(db);
      insert.run(migration.version, migration.name, clock().toISOString());
    });
    transaction();
    applied.push(migration.version);
  }

  return {
    applied,
    alreadyApplied: [...appliedVersions].sort((a, b) => a - b),
  };
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertEncryptedAtRest,
  ensureBaseSchema,
  getCipherVersion,
  getSqliteVersion,
  openEncryptedDatabase,
} from '../src/db/database.js';
import { expectPosixPrivateFile } from './helpers/permissions.js';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'lite-therapy-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('encrypted database', () => {
  it('stores data encrypted at rest and reopens with the correct key', () => {
    withTempDir((dir) => {
      const path = join(dir, 'counsel.db');
      const key = Buffer.alloc(32, 3);

      const db = openEncryptedDatabase(path, key);
      ensureBaseSchema(db);
      db.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(content, tokenize='trigram')");
      db.prepare('INSERT INTO notes_fts (content) VALUES (?)').run('心理咨询 第一次会谈');

      expect(getCipherVersion(db)).toBe('sqlcipher');
      expect(getSqliteVersion(db)).toMatch(/^\d+\.\d+/);
      expectPosixPrivateFile(path);
      db.close();

      assertEncryptedAtRest(path);

      const reopened = openEncryptedDatabase(path, key);
      const hit = reopened
        .prepare('SELECT content FROM notes_fts WHERE notes_fts MATCH ?')
        .get('心理咨') as { content: string } | undefined;
      expect(hit?.content).toContain('心理咨询');
      reopened.close();
    });
  });

  it('rejects a wrong key', () => {
    withTempDir((dir) => {
      const path = join(dir, 'counsel.db');
      const db = openEncryptedDatabase(path, Buffer.alloc(32, 1));
      ensureBaseSchema(db);
      db.close();

      expect(() => openEncryptedDatabase(path, Buffer.alloc(32, 2))).toThrow();
    });
  });
});

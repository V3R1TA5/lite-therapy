import { chmodSync, closeSync, mkdirSync, openSync, readSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

export type DatabaseConnection = Database.Database;

export class DatabaseKeyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseKeyError';
  }
}

export function openEncryptedDatabase(path: string, key: Buffer): DatabaseConnection {
  if (key.length !== 32) {
    throw new Error('数据库密钥必须是 32 字节。');
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);

  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('key = ' + JSON.stringify("x'" + key.toString('hex') + "'"));
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('secure_delete = ON');
    try {
      db.pragma('cipher_memory_security = ON');
    } catch {
      // 某些 SQLite 多密码实现没有这个 PRAGMA；不影响加密本身。
    }
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    secureDatabaseFiles(path);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // 已经关闭。
    }
    throw new DatabaseKeyError('无法打开加密数据库：密码错误或文件损坏。', {
      cause: error,
    });
  }
}

/**
 * SQLite 新建文件继承 umask，通常是 0644。数据目录虽然是 0700，
 * 仍把主库与 WAL/SHM 一起收紧到 0600，减少目录权限被改动时的暴露面。
 */
function secureDatabaseFiles(path: string): void {
  // Windows 上 chmod 不能表达 0600，且对打开中的 WAL/SHM 可能抛 EPERM；
  // 实际隔离依赖用户目录 ACL，这里直接交给文件系统。
  if (process.platform === 'win32') {
    return;
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      chmodSync(path + suffix, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export function ensureBaseSchema(db: DatabaseConnection): void {
  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

export function getMeta(db: DatabaseConnection, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setMeta(db: DatabaseConnection, key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function getCipherVersion(db: DatabaseConnection): string {
  try {
    const rows = db.pragma('cipher_version') as Array<Record<string, unknown>>;
    const first = rows[0];
    if (first) {
      const value = Object.values(first)[0];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  } catch {
    // SQLite3MC 没有 cipher_version 时继续尝试 cipher。
  }

  try {
    const rows = db.pragma('cipher') as Array<Record<string, unknown>>;
    const first = rows[0];
    if (first) {
      const name = Object.keys(first)[0];
      if (name) {
        return name;
      }
    }
  } catch {
    // 保持 unknown。
  }

  return 'unknown';
}

export function getSqliteVersion(db: DatabaseConnection): string {
  const row = db.prepare('SELECT sqlite_version() AS version').get() as
    | { version: string }
    | undefined;
  return row?.version ?? 'unknown';
}

export function readFileHeader(path: string, length = 16): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}

export function isPlaintextSqliteFile(path: string): boolean {
  const header = readFileHeader(path, 16);
  const sqliteHeader = Buffer.from('SQLite format 3' + String.fromCharCode(0), 'utf8');
  return header.length === sqliteHeader.length && header.equals(sqliteHeader);
}

export function assertEncryptedAtRest(path: string): void {
  if (isPlaintextSqliteFile(path)) {
    throw new Error('数据库文件仍然是明文 SQLite 头，加密没有生效。');
  }
}

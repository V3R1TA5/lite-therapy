import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseConnection } from './database.js';

export interface BackupOptions {
  prefix?: string;
  now?: Date;
}

/**
 * 迁移前备份。better-sqlite3 的 backup() 在 SQLCipher 下会因为源/目标
 * cipher 不一致而失败，所以改用 VACUUM INTO：它生成一致快照，
 * 且输出仍由当前 SQLCipher 连接加密。
 */
export async function backupDatabase(
  db: DatabaseConnection,
  backupDir: string,
  options: BackupOptions = {},
): Promise<string> {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const fileName = (options.prefix ?? 'counsel') + '-' + stamp + '.db';
  const filePath = join(backupDir, fileName);
  const escaped = filePath.replace(/'/g, "''");
  db.exec("VACUUM INTO '" + escaped + "'");
  chmodSync(filePath, 0o600);
  return filePath;
}

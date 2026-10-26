import { existsSync, readFileSync, statSync } from 'node:fs';
import { writeFileAtomic } from '../config/atomicFile.js';
import { parseVault, serializeVault, VaultError, type VaultFile } from './vault.js';

export const VAULT_FILE_MODE = 0o600;

export function vaultExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function loadVaultFile(filePath: string): VaultFile {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new VaultError('VAULT_MISSING', '还没有创建保险库，请先完成首次设置。');
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VaultError('CORRUPT_VAULT', '保险库文件不是合法的 JSON。', { cause: error });
  }
  return parseVault(parsed);
}

export function saveVaultFile(filePath: string, vault: VaultFile): void {
  writeFileAtomic(filePath, serializeVault(vault), VAULT_FILE_MODE);
}

export interface FilePermissionReport {
  mode: number;
  tooOpen: boolean;
}

/** 只检查，不擅自改权限；doctor 与设置页据此提示用户。 */
export function inspectFilePermissions(filePath: string): FilePermissionReport {
  const mode = statSync(filePath).mode & 0o777;
  return { mode, tooOpen: (mode & 0o077) !== 0 };
}

export function formatMode(mode: number): string {
  return mode.toString(8).padStart(3, '0');
}

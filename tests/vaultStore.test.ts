import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVault, unlockVault } from '../src/security/vault.js';
import {
  formatMode,
  inspectFilePermissions,
  loadVaultFile,
  saveVaultFile,
  vaultExists,
} from '../src/security/vaultStore.js';
import { expectPosixPrivateFile, isWindows } from './helpers/permissions.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const PASSPHRASE = 'test passphrase 123';
const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-vault-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('vaultStore', () => {
  it('writes the vault with private permissions and reads it back', async () => {
    const file = join(tempDir(), 'vault.json');
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });
    saveVaultFile(file, created.vault);

    expect(vaultExists(file)).toBe(true);
    expectPosixPrivateFile(file);
    const report = inspectFilePermissions(file);
    if (isWindows) {
      expect(report.tooOpen).toBe(false);
      expect(report.note).toContain('Windows');
    } else {
      expect(report).toEqual({ mode: 0o600, tooOpen: false });
    }
    expect(formatMode(0o600)).toBe('600');

    const loaded = loadVaultFile(file);
    const key = await unlockVault(loaded, PASSPHRASE);
    expect(key.equals(created.dbKey)).toBe(true);
  });

  const itPosix = isWindows ? it.skip : it;
  itPosix('reports overly open permissions without silently fixing them', async () => {
    const file = join(tempDir(), 'vault.json');
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });
    saveVaultFile(file, created.vault);
    chmodSync(file, 0o644);

    expect(inspectFilePermissions(file)).toEqual({ mode: 0o644, tooOpen: true });
  });

  it('reports Windows ACL semantics without Unix mode checks', async () => {
    const file = join(tempDir(), 'vault.json');
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });
    saveVaultFile(file, created.vault);
    const report = inspectFilePermissions(file, 'win32');
    expect(report.tooOpen).toBe(false);
    expect(report.note).toContain('Windows');
  });

  it('distinguishes a missing vault from a corrupt one', () => {
    const file = join(tempDir(), 'vault.json');
    expect(() => loadVaultFile(file)).toThrow(expect.objectContaining({ code: 'VAULT_MISSING' }));

    writeFileSync(file, '{not json');
    expect(() => loadVaultFile(file)).toThrow(expect.objectContaining({ code: 'CORRUPT_VAULT' }));
  });
});

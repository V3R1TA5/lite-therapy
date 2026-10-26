import { describe, expect, it } from 'vitest';
import {
  createRecoveryPhrase,
  createVault,
  parseVault,
  recoverVault,
  replacePassphrase,
  rewrapPassphrase,
  serializeVault,
  unlockVault,
  type VaultFile,
} from '../src/security/vault.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const PASSPHRASE = 'correct horse battery staple';
const NEW_PASSPHRASE = 'another long passphrase';

describe('vault', () => {
  it('creates a vault that unlocks with the passphrase and recovers with the phrase', async () => {
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });

    expect(created.recoveryPhrase.split(' ')).toHaveLength(12);
    expect(created.dbKey).toHaveLength(32);

    const unlocked = await unlockVault(created.vault, PASSPHRASE);
    expect(unlocked.equals(created.dbKey)).toBe(true);

    const recovered = await recoverVault(created.vault, created.recoveryPhrase);
    expect(recovered.equals(created.dbKey)).toBe(true);
  });

  it('rejects a wrong passphrase with a typed error', async () => {
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });

    await expect(unlockVault(created.vault, 'wrong passphrase')).rejects.toMatchObject({
      code: 'WRONG_SECRET',
    });
  });

  it('rejects an invalid recovery phrase', async () => {
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });

    await expect(recoverVault(created.vault, 'not a valid recovery phrase')).rejects.toMatchObject({
      code: 'INVALID_RECOVERY_PHRASE',
    });
  });

  it('detects tampered wrapped keys', async () => {
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });
    const tampered = JSON.parse(JSON.stringify(created.vault)) as VaultFile;
    const first = tampered.passphrase.ciphertext.charAt(0);
    tampered.passphrase.ciphertext =
      (first === 'A' ? 'B' : 'A') + tampered.passphrase.ciphertext.slice(1);

    await expect(unlockVault(tampered, PASSPHRASE)).rejects.toMatchObject({
      code: 'WRONG_SECRET',
    });
  });

  it('rewraps the database key without invalidating recovery', async () => {
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });
    const rewrapped = await rewrapPassphrase(created.vault, PASSPHRASE, NEW_PASSPHRASE);
    const unlocked = await unlockVault(rewrapped, NEW_PASSPHRASE);
    const recovered = await recoverVault(rewrapped, created.recoveryPhrase);

    expect(unlocked.equals(created.dbKey)).toBe(true);
    expect(recovered.equals(created.dbKey)).toBe(true);
    await expect(unlockVault(rewrapped, PASSPHRASE)).rejects.toMatchObject({
      code: 'WRONG_SECRET',
    });
  });

  it('accepts a caller-provided recovery phrase that the user already confirmed', async () => {
    const phrase = createRecoveryPhrase();
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF, mnemonic: phrase });

    expect(created.recoveryPhrase).toBe(phrase);
    const recovered = await recoverVault(created.vault, phrase);
    expect(recovered.equals(created.dbKey)).toBe(true);

    await expect(
      createVault(PASSPHRASE, { kdf: TEST_KDF, mnemonic: 'not a valid phrase' }),
    ).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PHRASE' });
  });

  it('replaces the passphrase from the database key without the old passphrase', async () => {
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });
    const updated = await replacePassphrase(created.vault, created.dbKey, NEW_PASSPHRASE);

    expect((await unlockVault(updated, NEW_PASSPHRASE)).equals(created.dbKey)).toBe(true);
    expect((await recoverVault(updated, created.recoveryPhrase)).equals(created.dbKey)).toBe(true);
    await expect(unlockVault(updated, PASSPHRASE)).rejects.toMatchObject({
      code: 'WRONG_SECRET',
    });
  });

  it('rejects a short passphrase', async () => {
    await expect(createVault('short', { kdf: TEST_KDF })).rejects.toMatchObject({
      code: 'WEAK_PASSPHRASE',
    });
  });

  it('serializes and parses a vault round trip', async () => {
    const created = await createVault(PASSPHRASE, { kdf: TEST_KDF });
    const text = serializeVault(created.vault);
    const parsed = parseVault(JSON.parse(text));
    expect(parsed.passphrase.salt).toBe(created.vault.passphrase.salt);
    expect(parsed.recovery.ciphertext).toBe(created.vault.recovery.ciphertext);
  });
});

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decryptSecrets,
  encryptSecrets,
  loadSecretsFile,
  saveSecretsFile,
} from '../src/security/secrets.js';
import { expectPosixPrivateFile } from './helpers/permissions.js';

const roots: string[] = [];
const DB_KEY = Buffer.alloc(32, 9);
const KEYS = { 'openai-main': 'sk-live-secret-value' };

function tempFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-secrets-'));
  roots.push(root);
  return join(root, 'secrets.enc');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('secrets', () => {
  it('encrypts API keys without writing plaintext', () => {
    const file = tempFile();
    saveSecretsFile(file, DB_KEY, KEYS);

    expectPosixPrivateFile(file);
    expect(readFileSync(file, 'utf8')).not.toContain('sk-live-secret-value');
    expect(loadSecretsFile(file, DB_KEY)).toEqual(KEYS);
  });

  it('rejects a different database key', () => {
    const file = tempFile();
    saveSecretsFile(file, DB_KEY, KEYS);
    expect(() => loadSecretsFile(file, randomBytes(32))).toThrow(
      expect.objectContaining({ code: 'CORRUPT_SECRETS' }),
    );
  });

  it('returns an empty map when the file does not exist', () => {
    expect(loadSecretsFile(tempFile(), DB_KEY)).toEqual({});
  });

  it('rejects invalid key ids and tampered payloads', () => {
    expect(() => encryptSecrets(DB_KEY, { 'Bad Id': 'x' })).toThrow(
      expect.objectContaining({ code: 'INVALID_KEY_ID' }),
    );

    const encrypted = encryptSecrets(DB_KEY, KEYS);
    const first = encrypted.ciphertext.charAt(0);
    const tampered = {
      ...encrypted,
      ciphertext: (first === 'A' ? 'B' : 'A') + encrypted.ciphertext.slice(1),
    };
    expect(() => decryptSecrets(DB_KEY, tampered)).toThrow(
      expect.objectContaining({ code: 'CORRUPT_SECRETS' }),
    );
  });
});

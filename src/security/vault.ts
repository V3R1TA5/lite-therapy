import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { z } from 'zod';

export interface KdfParams {
  N: number;
  r: number;
  p: number;
  dkLen: 32;
}

export const DEFAULT_KDF: KdfParams = { N: 65536, r: 8, p: 1, dkLen: 32 };

export interface WrappedKey {
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface VaultFile {
  version: 1;
  kdf: KdfParams & { name: 'scrypt' };
  passphrase: WrappedKey;
  recovery: WrappedKey;
  createdAt: string;
}

export type VaultErrorCode =
  | 'WRONG_SECRET'
  | 'INVALID_RECOVERY_PHRASE'
  | 'CORRUPT_VAULT'
  | 'VAULT_MISSING'
  | 'WEAK_PASSPHRASE';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VaultError';
    this.code = code;
  }
}

const wrappedKeySchema = z.object({
  salt: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
});

const vaultSchema = z.object({
  version: z.literal(1),
  kdf: z.object({
    name: z.literal('scrypt'),
    N: z.number().int().positive(),
    r: z.number().int().positive(),
    p: z.number().int().positive(),
    dkLen: z.literal(32),
  }),
  passphrase: wrappedKeySchema,
  recovery: wrappedKeySchema,
  createdAt: z.string().min(1),
});

const AAD_PREFIX = 'lite-therapy:vault:v1:';

function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize('NFKC');
}

function assertPassphrase(passphrase: string): void {
  const length = Array.from(passphrase).length;
  if (length < 8) {
    throw new VaultError('WEAK_PASSPHRASE', '启动密码至少需要 8 个字符。');
  }
  if (length > 1024) {
    throw new VaultError('WEAK_PASSPHRASE', '启动密码过长。');
  }
}

function normalizeKdf(input: KdfParams): KdfParams {
  const N = input.N;
  if (!Number.isInteger(N) || N < 1024 || N > 262144 || (N & (N - 1)) !== 0) {
    throw new Error('scrypt N 必须是 1024 到 262144 之间的 2 的幂。');
  }
  if (!Number.isInteger(input.r) || input.r < 1 || input.r > 32) {
    throw new Error('scrypt r 不合法。');
  }
  if (!Number.isInteger(input.p) || input.p < 1 || input.p > 16) {
    throw new Error('scrypt p 不合法。');
  }
  if (input.dkLen !== 32) {
    throw new Error('scrypt dkLen 必须是 32。');
  }
  return { N, r: input.r, p: input.p, dkLen: 32 };
}

function deriveKey(secret: string | Buffer, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      secret,
      salt,
      kdf.dkLen,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function wrapKey(
  dbKey: Buffer,
  wrappingKey: Buffer,
  purpose: 'passphrase' | 'recovery',
): WrappedKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
  cipher.setAAD(Buffer.from(AAD_PREFIX + purpose, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(dbKey), cipher.final()]);
  return {
    salt: '',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function unwrapKey(
  wrapped: WrappedKey,
  wrappingKey: Buffer,
  purpose: 'passphrase' | 'recovery',
): Buffer {
  try {
    const iv = Buffer.from(wrapped.iv, 'base64');
    const tag = Buffer.from(wrapped.tag, 'base64');
    const ciphertext = Buffer.from(wrapped.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
    decipher.setAAD(Buffer.from(AAD_PREFIX + purpose, 'utf8'));
    decipher.setAuthTag(tag);
    const dbKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (dbKey.length !== 32) {
      throw new Error('数据库密钥长度不正确。');
    }
    return dbKey;
  } catch (error) {
    throw new VaultError('WRONG_SECRET', '密码或恢复短语不正确，或保险库已损坏。', {
      cause: error,
    });
  }
}

function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

export function parseVault(input: unknown): VaultFile {
  const result = vaultSchema.safeParse(input);
  if (!result.success) {
    throw new VaultError('CORRUPT_VAULT', '保险库文件格式不正确。', {
      cause: result.error,
    });
  }
  return result.data;
}

export function serializeVault(vault: VaultFile): string {
  return JSON.stringify(parseVault(vault), null, 2) + '\n';
}

export interface CreateVaultResult {
  vault: VaultFile;
  recoveryPhrase: string;
  dbKey: Buffer;
}

export interface CreateVaultOptions {
  kdf?: KdfParams;
  /** 允许调用方先生成并让用户确认短语，再创建保险库。 */
  mnemonic?: string;
}

export function createRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

export async function createVault(
  passphrase: string,
  options: CreateVaultOptions = {},
): Promise<CreateVaultResult> {
  assertPassphrase(passphrase);
  const kdf = normalizeKdf(options.kdf ?? DEFAULT_KDF);
  const dbKey = randomBytes(32);
  const recoveryPhrase =
    options.mnemonic === undefined
      ? generateMnemonic(wordlist, 128)
      : normalizeRecoveryPhrase(options.mnemonic);
  if (!validateMnemonic(recoveryPhrase, wordlist)) {
    throw new VaultError('INVALID_RECOVERY_PHRASE', '恢复短语不是有效的 12 词短语。');
  }
  const recoverySeed = Buffer.from(mnemonicToSeedSync(recoveryPhrase));
  const passphraseSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);

  const passphraseKey = await deriveKey(normalizePassphrase(passphrase), passphraseSalt, kdf);
  const recoveryKey = await deriveKey(recoverySeed, recoverySalt, kdf);

  const passphraseWrapped = wrapKey(dbKey, passphraseKey, 'passphrase');
  passphraseWrapped.salt = passphraseSalt.toString('base64');
  const recoveryWrapped = wrapKey(dbKey, recoveryKey, 'recovery');
  recoveryWrapped.salt = recoverySalt.toString('base64');

  wipe(passphraseKey);
  wipe(recoveryKey);
  wipe(recoverySeed);

  const vault: VaultFile = {
    version: 1,
    kdf: { name: 'scrypt', ...kdf },
    passphrase: passphraseWrapped,
    recovery: recoveryWrapped,
    createdAt: new Date().toISOString(),
  };

  return { vault, recoveryPhrase, dbKey };
}

export async function unlockVault(vault: VaultFile, passphrase: string): Promise<Buffer> {
  const parsed = parseVault(vault);
  const salt = Buffer.from(parsed.passphrase.salt, 'base64');
  const passphraseKey = await deriveKey(normalizePassphrase(passphrase), salt, parsed.kdf);
  try {
    return unwrapKey(parsed.passphrase, passphraseKey, 'passphrase');
  } finally {
    wipe(passphraseKey);
  }
}

export async function recoverVault(vault: VaultFile, phrase: string): Promise<Buffer> {
  const parsed = parseVault(vault);
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new VaultError(
      'INVALID_RECOVERY_PHRASE',
      '恢复短语不是有效的 12 词短语，请检查拼写与顺序。',
    );
  }
  const seed = Buffer.from(mnemonicToSeedSync(normalized));
  const salt = Buffer.from(parsed.recovery.salt, 'base64');
  const recoveryKey = await deriveKey(seed, salt, parsed.kdf);
  try {
    return unwrapKey(parsed.recovery, recoveryKey, 'recovery');
  } finally {
    wipe(recoveryKey);
    wipe(seed);
  }
}

export async function rewrapPassphrase(
  vault: VaultFile,
  oldPassphrase: string,
  newPassphrase: string,
): Promise<VaultFile> {
  assertPassphrase(newPassphrase);
  const parsed = parseVault(vault);
  const dbKey = await unlockVault(parsed, oldPassphrase);
  const salt = randomBytes(16);
  const newKey = await deriveKey(normalizePassphrase(newPassphrase), salt, parsed.kdf);
  try {
    const wrapped = wrapKey(dbKey, newKey, 'passphrase');
    wrapped.salt = salt.toString('base64');
    return { ...parsed, passphrase: wrapped };
  } finally {
    wipe(dbKey);
    wipe(newKey);
  }
}

/**
 * 用已获得的数据库密钥重新包裹密码槽。恢复短语槽保持不变，
 * 因此用恢复短语进来的用户设置新密码后，旧短语仍然有效。
 */
export async function replacePassphrase(
  vault: VaultFile,
  dbKey: Buffer,
  newPassphrase: string,
): Promise<VaultFile> {
  assertPassphrase(newPassphrase);
  const parsed = parseVault(vault);
  if (dbKey.length !== 32) {
    throw new Error('数据库密钥必须是 32 字节。');
  }
  const salt = randomBytes(16);
  const newKey = await deriveKey(normalizePassphrase(newPassphrase), salt, parsed.kdf);
  try {
    const wrapped = wrapKey(dbKey, newKey, 'passphrase');
    wrapped.salt = salt.toString('base64');
    return { ...parsed, passphrase: wrapped };
  } finally {
    wipe(newKey);
  }
}

export function wipe(buffer: Buffer): void {
  buffer.fill(0);
}

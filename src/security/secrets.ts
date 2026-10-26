import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { writeFileAtomic } from '../config/atomicFile.js';

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_VALUE_LENGTH = 8192;

const secretsFileSchema = z.strictObject({
  version: z.literal(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
});

export type SecretsFile = z.infer<typeof secretsFileSchema>;
export type ApiKeyMap = Record<string, string>;

export type SecretsErrorCode = 'CORRUPT_SECRETS' | 'INVALID_KEY_ID' | 'INVALID_KEY_VALUE';

export class SecretsError extends Error {
  readonly code: SecretsErrorCode;

  constructor(code: SecretsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SecretsError';
    this.code = code;
  }
}

const AAD = 'lite-therapy:secrets:v1';

function deriveSecretsKey(dbKey: Buffer): Buffer {
  if (dbKey.length !== 32) {
    throw new SecretsError('CORRUPT_SECRETS', '数据库密钥长度不正确，无法解密 API Key。');
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      dbKey,
      Buffer.from('lite-therapy:secrets:salt:v1'),
      Buffer.from('api-keys'),
      32,
    ),
  );
}

function validateMap(keys: ApiKeyMap): ApiKeyMap {
  const entries = Object.entries(keys);
  if (entries.length > 16) {
    throw new SecretsError('INVALID_KEY_ID', '密钥条目过多。');
  }
  const normalized: ApiKeyMap = {};
  for (const [id, value] of entries) {
    if (!KEY_ID_PATTERN.test(id)) {
      throw new SecretsError('INVALID_KEY_ID', '密钥条目 ID 不合法。');
    }
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VALUE_LENGTH) {
      throw new SecretsError('INVALID_KEY_VALUE', '密钥内容为空或过长。');
    }
    normalized[id] = value;
  }
  return normalized;
}

export function encryptSecrets(dbKey: Buffer, keys: ApiKeyMap): SecretsFile {
  const normalized = validateMap(keys);
  const wrappingKey = deriveSecretsKey(dbKey);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
    cipher.setAAD(Buffer.from(AAD, 'utf8'));
    const plaintext = Buffer.from(JSON.stringify(normalized), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  } finally {
    wrappingKey.fill(0);
  }
}

export function decryptSecrets(dbKey: Buffer, input: unknown): ApiKeyMap {
  const parsed = secretsFileSchema.safeParse(input);
  if (!parsed.success) {
    throw new SecretsError('CORRUPT_SECRETS', '密钥文件格式不正确。', { cause: parsed.error });
  }

  const wrappingKey = deriveSecretsKey(dbKey);
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      wrappingKey,
      Buffer.from(parsed.data.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(AAD, 'utf8'));
    decipher.setAuthTag(Buffer.from(parsed.data.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.data.ciphertext, 'base64')),
      decipher.final(),
    ]);
    let keys: unknown;
    try {
      keys = JSON.parse(plaintext.toString('utf8'));
    } finally {
      plaintext.fill(0);
    }
    return validateMap(keys as ApiKeyMap);
  } catch (error) {
    if (error instanceof SecretsError) {
      throw error;
    }
    throw new SecretsError('CORRUPT_SECRETS', '密钥文件无法解密：数据库密钥不匹配或文件损坏。', {
      cause: error,
    });
  } finally {
    wrappingKey.fill(0);
  }
}

export function loadSecretsFile(filePath: string, dbKey: Buffer): ApiKeyMap {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SecretsError('CORRUPT_SECRETS', '密钥文件不是合法的 JSON。', { cause: error });
  }
  return decryptSecrets(dbKey, parsed);
}

export function saveSecretsFile(filePath: string, dbKey: Buffer, keys: ApiKeyMap): void {
  const file = encryptSecrets(dbKey, keys);
  writeFileAtomic(filePath, JSON.stringify(file, null, 2) + '\n', 0o600);
}

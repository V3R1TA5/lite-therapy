import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const crisisResourceSchema = z.strictObject({
  region: z.string().trim().max(80).optional(),
  emergency: z.string().trim().max(80).optional(),
  crisis_line: z.string().trim().max(80).optional(),
  text_line: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  source_url: z.string().url().max(300).optional(),
  verified_at: z.string().trim().max(40).optional(),
});

const fileSchema = z.strictObject({
  version: z.literal(1).default(1),
  resources: z.array(crisisResourceSchema).max(20).default([]),
});

export type CrisisResource = z.infer<typeof crisisResourceSchema>;

export interface CrisisResources {
  version: 1;
  resources: CrisisResource[];
}

export class CrisisResourcesError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CrisisResourcesError';
  }
}

export const EMPTY_CRISIS_RESOURCES: CrisisResources = { version: 1, resources: [] };

function normalize(input: unknown): CrisisResources {
  if (Array.isArray(input)) {
    const resources = z.array(crisisResourceSchema).max(20).safeParse(input);
    if (!resources.success) {
      throw new CrisisResourcesError('危机资源文件格式不正确。', { cause: resources.error });
    }
    return { version: 1, resources: resources.data };
  }
  if (input !== null && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if ('resources' in record) {
      const parsed = fileSchema.safeParse(record);
      if (!parsed.success) {
        throw new CrisisResourcesError('危机资源文件格式不正确。', { cause: parsed.error });
      }
      return { version: 1, resources: parsed.data.resources };
    }
    const single = crisisResourceSchema.safeParse(record);
    if (single.success) {
      return { version: 1, resources: Object.keys(record).length > 0 ? [single.data] : [] };
    }
  }
  throw new CrisisResourcesError('危机资源文件格式不正确。');
}

/**
 * 只读取用户自己放在配置目录的危机资源；程序不内置任何热线号码。
 * 文件缺失时返回空列表，不影响会谈。
 */
export function loadCrisisResources(path: string): CrisisResources {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_CRISIS_RESOURCES;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CrisisResourcesError('危机资源文件不是合法的 JSON。', { cause: error });
  }
  return normalize(parsed);
}

export function crisisResourcesTemplate(): string {
  return JSON.stringify(
    {
      version: 1,
      resources: [
        {
          region: '你所在的地区',
          emergency: '当地急救电话（请自行核对）',
          crisis_line: '当地危机热线（请自行核对）',
          text_line: '当地文字支持（可选）',
          notes: '请只填写你亲自核对过的号码与信息。Lite Therapy 不内置号码。',
          source_url: 'https://example.org/verify-locally',
          verified_at: 'YYYY-MM-DD',
        },
      ],
    },
    null,
    2,
  );
}

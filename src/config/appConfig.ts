import { readFileSync } from 'node:fs';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { z } from 'zod';
import { normalizeBaseUrl } from '../core/endpoint.js';
import { writeFileAtomic } from './atomicFile.js';

export const CONFIG_VERSION = 1 as const;
export const CONSENT_VERSION = '2026-10-ai-disclosure-v1' as const;

export const LOCK_TIMEOUTS = [0, 5, 10, 30] as const;
export type LockTimeout = (typeof LOCK_TIMEOUTS)[number];

export const AGE_BANDS = ['unspecified', 'adult', 'minor'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const MODEL_KINDS = ['openai-compatible', 'ollama'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export const THEME_MODES = ['dark', 'light'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export interface ModelProfile {
  id: string;
  label: string;
  kind: ModelKind;
  baseUrl: string;
  model: string;
}

export interface ProfileSettings {
  displayName: string;
  locale: 'zh-CN';
  timezone: string;
  ageBand: AgeBand;
}

export interface MemorySettings {
  enabled: boolean;
  includeSensitive: boolean;
  embeddingModel: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  includeSensitive: false,
  embeddingModel: '',
};

export interface ContextBudgetSettings {
  historyTokens: number;
  summaryTriggerTokens: number;
  recentTargetTokens: number;
}

export const DEFAULT_CONTEXT_BUDGET_SETTINGS: ContextBudgetSettings = {
  historyTokens: 24_000,
  summaryTriggerTokens: 12_000,
  recentTargetTokens: 10_000,
};

export const CONTEXT_BUDGET_PRESETS = {
  compact: { historyTokens: 12_000, summaryTriggerTokens: 6_000, recentTargetTokens: 6_000 },
  default: DEFAULT_CONTEXT_BUDGET_SETTINGS,
  long: { historyTokens: 32_000, summaryTriggerTokens: 16_000, recentTargetTokens: 14_000 },
} as const;

export type ContextBudgetPreset = keyof typeof CONTEXT_BUDGET_PRESETS;

export interface AppConfig {
  version: 1;
  consent: { version: string; acceptedAt: string };
  onboardingCompletedAt?: string;
  profile: ProfileSettings;
  models: { profiles: ModelProfile[]; activeProfileId?: string };
  lock: { timeoutMinutes: LockTimeout };
  theme: ThemeMode;
  context: ContextBudgetSettings;
  memory: MemorySettings;
}

export type ConfigErrorCode = 'CONFIG_CORRUPT' | 'CONFIG_INVALID';

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
    this.code = code;
  }
}

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: '需要 ISO 8601 时间字符串。',
});

const profileSettingsSchema = z.strictObject({
  displayName: z.string().trim().max(40).default(''),
  locale: z.literal('zh-CN'),
  timezone: z.string().trim().min(1).max(64),
  ageBand: z.enum(AGE_BANDS).default('unspecified'),
});

const modelProfileSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, '模型档案 ID 只能用小写字母、数字与连字符。'),
    label: z.string().trim().min(1).max(40),
    kind: z.enum(MODEL_KINDS),
    baseUrl: z.string().transform((value, context) => {
      try {
        return normalizeBaseUrl(value);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : '接口地址不合法。',
        });
        return z.NEVER;
      }
    }),
    model: z.string().trim().min(1).max(120),
  })
  .superRefine((value, context) => {
    if (value.kind === 'ollama' && /\/chat\/completions$/.test(value.baseUrl)) {
      context.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'Ollama 地址只需要到 /v1，不要包含 /chat/completions。',
      });
    }
  });

const contextBudgetSchema = z
  .strictObject({
    historyTokens: z.number().int().min(4000).max(96_000).default(24_000),
    summaryTriggerTokens: z.number().int().min(2000).max(96_000).default(12_000),
    recentTargetTokens: z.number().int().min(1000).max(96_000).default(10_000),
  })
  .superRefine((value, context) => {
    if (value.summaryTriggerTokens > value.historyTokens) {
      context.addIssue({
        code: 'custom',
        path: ['summaryTriggerTokens'],
        message: '摘要触发预算不能大于历史预算。',
      });
    }
    if (value.recentTargetTokens > value.historyTokens) {
      context.addIssue({
        code: 'custom',
        path: ['recentTargetTokens'],
        message: '最近原文预算不能大于历史预算。',
      });
    }
    if (value.recentTargetTokens > value.summaryTriggerTokens) {
      context.addIssue({
        code: 'custom',
        path: ['recentTargetTokens'],
        message: '最近原文预算不能大于摘要触发预算。',
      });
    }
  });

const appConfigSchema = z
  .strictObject({
    version: z.literal(CONFIG_VERSION),
    consent: z.strictObject({
      version: z.string().min(1),
      acceptedAt: isoDate,
    }),
    onboardingCompletedAt: isoDate.optional(),
    profile: profileSettingsSchema,
    models: z
      .strictObject({
        profiles: z.array(modelProfileSchema).max(8).default([]),
        activeProfileId: z.string().optional(),
      })
      .superRefine((value, context) => {
        if (value.activeProfileId === undefined) {
          return;
        }
        if (!value.profiles.some((profile) => profile.id === value.activeProfileId)) {
          context.addIssue({
            code: 'custom',
            path: ['activeProfileId'],
            message: '当前模型档案不在档案列表里。',
          });
        }
      }),
    lock: z.strictObject({
      timeoutMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(30)]),
    }),
    theme: z.enum(THEME_MODES).default('dark'),
    context: contextBudgetSchema.default(DEFAULT_CONTEXT_BUDGET_SETTINGS),
    memory: z
      .strictObject({
        enabled: z.boolean().default(true),
        includeSensitive: z.boolean().default(false),
        embeddingModel: z.string().trim().max(100).default(''),
      })
      .default(DEFAULT_MEMORY_SETTINGS),
  })
  .superRefine((value, context) => {
    // strictObject 已拒绝未知键；这里再挡一道常见密钥字段名，
    // 防止未来有人为了省事把 API Key 加进配置结构。
    const serialized = JSON.stringify(value);
    if (/"(api[_-]?key|secret|token|password)"\s*:/i.test(serialized)) {
      context.addIssue({
        code: 'custom',
        message: '配置文件不允许包含密钥类字段。',
      });
    }
  });

export function parseAppConfig(input: unknown): AppConfig {
  const result = appConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError('CONFIG_INVALID', '配置内容不合法：' + result.error.issues[0]?.message, {
      cause: result.error,
    });
  }
  return result.data;
}

export function createInitialConfig(now: Date, timezone: string): AppConfig {
  return parseAppConfig({
    version: CONFIG_VERSION,
    consent: { version: CONSENT_VERSION, acceptedAt: now.toISOString() },
    profile: {
      displayName: '',
      locale: 'zh-CN',
      timezone: timezone.trim().length > 0 ? timezone : 'UTC',
      ageBand: 'unspecified',
    },
    models: { profiles: [] },
    lock: { timeoutMinutes: 10 },
    theme: 'dark',
    context: DEFAULT_CONTEXT_BUDGET_SETTINGS,
    memory: DEFAULT_MEMORY_SETTINGS,
  });
}

export function loadAppConfig(filePath: string): AppConfig | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw) as unknown;
  } catch (error) {
    throw new ConfigError('CONFIG_CORRUPT', '配置文件不是合法的 TOML。', { cause: error });
  }
  return parseAppConfig(parsed);
}

export function saveAppConfig(filePath: string, config: AppConfig): void {
  const validated = parseAppConfig(config);
  writeFileAtomic(filePath, stringifyToml(compact(validated)) + '\n', 0o600);
}

/** TOML 没有 null；递归去掉 undefined，保证可选字段不被写成字符串。 */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => compact(item));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, compact(item)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 && isValidTimezone(trimmed) ? trimmed : 'UTC';
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

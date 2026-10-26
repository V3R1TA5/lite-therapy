import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  createInitialConfig,
  DEFAULT_CONTEXT_BUDGET_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
  loadAppConfig,
  parseAppConfig,
  resolveTimezone,
  saveAppConfig,
} from '../src/config/appConfig.js';

const roots: string[] = [];

function tempFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-config-'));
  roots.push(root);
  return join(root, 'config.toml');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('appConfig', () => {
  it('round-trips config as 0600 TOML', () => {
    const file = tempFile();
    const config = createInitialConfig(new Date('2026-10-26T00:00:00.000Z'), 'Asia/Tokyo');
    saveAppConfig(file, config);

    expect(statSync(file).mode & 0o777).toBe(0o600);
    const loaded = loadAppConfig(file);
    expect(loaded?.profile.timezone).toBe('Asia/Tokyo');
    expect(loaded?.lock.timeoutMinutes).toBe(10);
    expect(loaded?.onboardingCompletedAt).toBeUndefined();
    expect(readFileSync(file, 'utf8')).not.toContain('apiKey');
  });

  it('normalizes model base URLs and rejects plaintext remote endpoints', () => {
    const config = createInitialConfig(new Date(), 'UTC');
    const parsed = parseAppConfig({
      ...config,
      models: {
        profiles: [
          {
            id: 'local',
            label: 'Ollama',
            kind: 'ollama',
            baseUrl: 'http://127.0.0.1:11434/v1/',
            model: 'qwen3',
          },
        ],
        activeProfileId: 'local',
      },
    });
    expect(parsed.models.profiles[0]?.baseUrl).toBe('http://127.0.0.1:11434/v1');

    expect(() =>
      parseAppConfig({
        ...config,
        models: {
          profiles: [
            {
              id: 'remote',
              label: 'Remote',
              kind: 'openai-compatible',
              baseUrl: 'http://api.example.com/v1',
              model: 'x',
            },
          ],
        },
      }),
    ).toThrow(ConfigError);
  });

  it('refuses key-like fields anywhere in the config', () => {
    const config = createInitialConfig(new Date(), 'UTC');
    expect(() => parseAppConfig({ ...config, apiKey: 'sk-test' })).toThrow(ConfigError);
    expect(() =>
      parseAppConfig({
        ...config,
        models: {
          profiles: [
            {
              id: 'x',
              label: 'X',
              kind: 'openai-compatible',
              baseUrl: 'https://api.example.com/v1',
              model: 'x',
              token: 'sk-test',
            },
          ],
        },
      }),
    ).toThrow(ConfigError);
  });

  it('defaults context budgets and rejects invalid budget order', () => {
    const config = createInitialConfig(new Date(), 'UTC');
    expect(config.context).toEqual(DEFAULT_CONTEXT_BUDGET_SETTINGS);
    expect(config.memory).toEqual(DEFAULT_MEMORY_SETTINGS);

    const { context: _context, memory: _memory, ...withoutDefaults } = config;
    expect(parseAppConfig(withoutDefaults).context).toEqual(DEFAULT_CONTEXT_BUDGET_SETTINGS);
    expect(parseAppConfig(withoutDefaults).memory).toEqual(DEFAULT_MEMORY_SETTINGS);

    expect(() =>
      parseAppConfig({
        ...config,
        context: {
          historyTokens: 8000,
          summaryTriggerTokens: 12_000,
          recentTargetTokens: 6000,
        },
      }),
    ).toThrow(ConfigError);
  });

  it('falls back to UTC for an invalid timezone', () => {
    expect(resolveTimezone('Not/AZone')).toBe('UTC');
    expect(resolveTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});

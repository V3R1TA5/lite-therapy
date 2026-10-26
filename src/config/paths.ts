import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import envPaths from 'env-paths';
import { APP_SLUG } from '../core/version.js';

export interface AppPaths {
  data: string;
  config: string;
  log: string;
}

const defaults = envPaths(APP_SLUG, { suffix: '' });

export function getAppPaths(): AppPaths {
  const override = process.env.LITE_THERAPY_HOME;
  if (override && override.trim().length > 0) {
    return {
      data: join(override, 'data'),
      config: join(override, 'config'),
      log: join(override, 'log'),
    };
  }
  return {
    data: defaults.data,
    config: defaults.config,
    log: defaults.log,
  };
}

export function ensureDirectories(paths: AppPaths): AppPaths {
  for (const dir of [paths.data, paths.config, paths.log]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return paths;
}

export function ensureAppDirs(): AppPaths {
  return ensureDirectories(getAppPaths());
}

export function getDatabasePath(): string {
  return join(getAppPaths().data, 'counsel.db');
}

export function getVaultPath(): string {
  return join(getAppPaths().config, 'vault.json');
}

export function getConfigPath(): string {
  return join(getAppPaths().config, 'config.toml');
}

export function getSecretsPath(): string {
  return join(getAppPaths().config, 'secrets.enc');
}

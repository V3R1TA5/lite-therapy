import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import envPaths from 'env-paths';
import { APP_SLUG } from '../core/version.js';

export interface AppPaths {
  data: string;
  config: string;
  log: string;
}

export interface AppPathsOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const defaults = envPaths(APP_SLUG, { suffix: '' });
const defaultPaths: AppPaths = {
  data: defaults.data,
  config: defaults.config,
  log: defaults.log,
};

/**
 * LITE_THERAPY_HOME 是便携/测试用的整体覆盖。
 * 相对路径按启动目录解析，绝对路径原样使用；未设置时走平台惯例目录。
 */
export function resolveAppPaths(
  override: string | undefined,
  fallback: AppPaths,
  cwd = process.cwd(),
): AppPaths {
  const home = override?.trim();
  if (!home) {
    return { ...fallback };
  }
  const root = resolve(cwd, home);
  return {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
}

export function getAppPaths(options: AppPathsOptions = {}): AppPaths {
  const env = options.env ?? process.env;
  return resolveAppPaths(env.LITE_THERAPY_HOME, defaultPaths, options.cwd);
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

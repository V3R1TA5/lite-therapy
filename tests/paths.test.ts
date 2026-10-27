import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AppPaths, getAppPaths, resolveAppPaths } from '../src/config/paths.js';

const cwd = resolve('test-fixtures', 'project');
const fallback: AppPaths = {
  data: resolve(cwd, 'default-data'),
  config: resolve(cwd, 'default-config'),
  log: resolve(cwd, 'default-log'),
};

describe('resolveAppPaths', () => {
  it('uses the platform defaults when no override is set', () => {
    expect(resolveAppPaths(undefined, fallback, cwd)).toEqual(fallback);
    expect(resolveAppPaths('   ', fallback, cwd)).toEqual(fallback);
  });

  it('resolves a relative LITE_THERAPY_HOME against cwd', () => {
    expect(resolveAppPaths('.tmp/home', fallback, cwd)).toEqual({
      data: resolve(cwd, '.tmp/home/data'),
      config: resolve(cwd, '.tmp/home/config'),
      log: resolve(cwd, '.tmp/home/log'),
    });
  });

  it('keeps an absolute LITE_THERAPY_HOME', () => {
    const home = resolve('test-fixtures', 'absolute-home');
    expect(resolveAppPaths(home, fallback, cwd).config).toBe(resolve(home, 'config'));
  });

  it('wires the environment override into getAppPaths', () => {
    const paths = getAppPaths({
      cwd,
      env: { LITE_THERAPY_HOME: '.tmp/home' },
    });
    expect(paths.data).toBe(resolve(cwd, '.tmp/home/data'));
  });

  it('uses an app-specific default path when no override is set', () => {
    const paths = getAppPaths({ cwd, env: {} });
    expect(paths.data).toContain('lite-therapy');
    expect(paths.config).toContain('lite-therapy');
    expect(paths.log).toContain('lite-therapy');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import { runDiagnostics } from '../src/services/doctor.js';

const roots: string[] = [];

function makePaths(): AppPaths {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-doctor-test-'));
  roots.push(root);
  return { data: join(root, 'data'), config: join(root, 'config'), log: join(root, 'log') };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('runDiagnostics', () => {
  it('passes all checks on a fresh, unwritable-nothing machine layout', async () => {
    const checks = await runDiagnostics({ paths: makePaths() });
    const failed = checks.filter((check) => !check.ok);
    expect(failed).toEqual([]);
    expect(checks.map((check) => check.name)).toContain('migrations');
    expect(checks.map((check) => check.name)).toContain('secrets');
    expect(checks.find((check) => check.name === 'setup')?.detail).toContain('未初始化');

    const windowsChecks = await runDiagnostics({ paths: makePaths(), platform: 'win32' });
    expect(windowsChecks.filter((check) => !check.ok)).toEqual([]);
    expect(windowsChecks.find((check) => check.name === 'database_mode')?.detail).toContain(
      'Windows ACL',
    );
    expect(windowsChecks.find((check) => check.name === 'config')?.detail).toContain('Windows ACL');
  });
});

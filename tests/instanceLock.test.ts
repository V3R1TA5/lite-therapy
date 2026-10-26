import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireInstanceLock, INSTANCE_LOCK_FILE } from '../src/services/instanceLock.js';

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-lock-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('instance lock', () => {
  it('allows one owner and reports the live holder', () => {
    const dir = tempDir();
    const first = acquireInstanceLock(dir, { pid: 1234, isAlive: () => true });
    expect(first.ok).toBe(true);

    const second = acquireInstanceLock(dir, { pid: 5678, isAlive: () => true });
    expect(second).toEqual({ ok: false, holderPid: 1234 });

    if (first.ok) {
      first.lock.release();
    }
    const third = acquireInstanceLock(dir, { pid: 5678, isAlive: () => true });
    expect(third.ok).toBe(true);
    if (third.ok) {
      third.lock.release();
    }
  });

  it('replaces a stale lock whose PID is not alive', () => {
    const dir = tempDir();
    const path = join(dir, INSTANCE_LOCK_FILE);
    writeFileSync(path, JSON.stringify({ pid: 999999, token: 'old', startedAt: '' }), {
      mode: 0o600,
    });

    const acquired = acquireInstanceLock(dir, { pid: 42, isAlive: () => false });
    expect(acquired.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(42);
    if (acquired.ok) {
      acquired.lock.release();
    }
  });

  it('does not release a lock owned by another token', () => {
    const dir = tempDir();
    const first = acquireInstanceLock(dir, { pid: 1, isAlive: () => true });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const path = first.lock.path;
    first.lock.release();
    expect(() => readFileSync(path, 'utf8')).toThrow();
  });
});

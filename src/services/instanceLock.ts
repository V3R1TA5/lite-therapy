import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const INSTANCE_LOCK_FILE = 'instance.lock';

interface LockPayload {
  pid: number;
  token: string;
  startedAt: string;
}

export interface InstanceLock {
  path: string;
  pid: number;
  release: () => void;
}

export interface AcquireLockOptions {
  pid?: number;
  isAlive?: (pid: number) => boolean;
}

export type AcquireLockResult =
  | { ok: true; lock: InstanceLock }
  | { ok: false; holderPid: number | null };

function defaultIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readPayload(path: string): LockPayload | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockPayload>;
    if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') {
      return null;
    }
    return {
      pid: parsed.pid,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    };
  } catch {
    return null;
  }
}

function tryCreate(path: string, payload: LockPayload): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify(payload) + '\n');
  } finally {
    closeSync(fd);
  }
  return true;
}

function releaseOwnLock(path: string, token: string): void {
  const payload = readPayload(path);
  if (payload !== null && payload.token === token) {
    try {
      unlinkSync(path);
    } catch {
      // 已经不存在或无法删除；下次启动会按 PID 判定陈旧锁。
    }
  }
}

/**
 * 数据目录单实例锁。锁内记录 PID 与随机 token；进程崩溃后留下的锁
 * 会通过 PID 存活探测判定为陈旧锁，不会永久阻塞用户。
 */
export function acquireInstanceLock(
  dataDir: string,
  options: AcquireLockOptions = {},
): AcquireLockResult {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, INSTANCE_LOCK_FILE);
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? defaultIsAlive;
  const token = randomBytes(16).toString('hex');
  const payload: LockPayload = { pid, token, startedAt: new Date().toISOString() };

  if (tryCreate(path, payload)) {
    return {
      ok: true,
      lock: { path, pid, release: () => releaseOwnLock(path, token) },
    };
  }

  const holder = readPayload(path);
  if (holder !== null && isAlive(holder.pid) && holder.pid !== pid) {
    return { ok: false, holderPid: holder.pid };
  }

  // 陈旧锁或损坏锁：删除后重试一次。若期间被别人抢到，就报告占用者。
  try {
    unlinkSync(path);
  } catch {
    // 其他进程可能刚刚删除；继续重试。
  }
  if (tryCreate(path, payload)) {
    return {
      ok: true,
      lock: { path, pid, release: () => releaseOwnLock(path, token) },
    };
  }
  const current = readPayload(path);
  return { ok: false, holderPid: current?.pid ?? null };
}

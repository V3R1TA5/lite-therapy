import { statSync } from 'node:fs';
import { expect } from 'vitest';

// Windows 的 chmod 不能表达 Unix mode；这些断言只在 POSIX 上运行。
export const isWindows = process.platform === 'win32';

export function expectPosixMode(filePath: string, expected: number): void {
  if (isWindows) {
    return;
  }
  expect(statSync(filePath).mode & 0o777).toBe(expected);
}

export function expectPosixPrivateFile(filePath: string): void {
  expectPosixMode(filePath, 0o600);
}

export function expectPosixPrivateDir(dirPath: string): void {
  expectPosixMode(dirPath, 0o700);
}

export function expectPosixNoGroupOrOther(filePath: string): void {
  if (isWindows) {
    return;
  }
  expect(statSync(filePath).mode & 0o077).toBe(0);
}

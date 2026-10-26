import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * 写敏感文件时先写临时文件、fsync 后再 rename，避免崩溃留下半截内容。
 * 权限在创建时就设好，缩小其他用户短暂读到明文的窗口。
 */
export function writeFileAtomic(filePath: string, contents: string | Buffer, mode = 0o600): void {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const suffix = randomBytes(6).toString('hex');
  const tempPath = filePath + '.' + process.pid + '.' + suffix + '.tmp';
  const fd = openSync(tempPath, 'w', mode);
  try {
    if (typeof contents === 'string') {
      writeSync(fd, contents);
    } else {
      writeSync(fd, contents);
    }
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(tempPath);
    } catch {
      // 清理失败不掩盖原始错误。
    }
    throw error;
  }
  closeSync(fd);

  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // 忽略清理失败。
    }
    throw error;
  }
}

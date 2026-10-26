import { randomInt as nodeRandomInt } from 'node:crypto';

export interface RecoveryChallenge {
  indexes: number[];
  words: string[];
}

export type RandomInt = (maxExclusive: number) => number;

export function splitMnemonic(phrase: string): string[] {
  return phrase
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** 随机抽 3 个词，要求用户回填；这是“抄写过”的最低确认，不是密码学证明。 */
export function createRecoveryChallenge(
  phrase: string,
  randomInt: RandomInt = nodeRandomInt,
): RecoveryChallenge {
  const words = splitMnemonic(phrase);
  if (words.length !== 12) {
    throw new Error('恢复短语必须是 12 个词。');
  }

  const order = words.map((_, index) => index);
  for (let i = 0; i < 3; i += 1) {
    const swapIndex = i + randomInt(order.length - i);
    const left = order[i];
    const right = order[swapIndex];
    if (left === undefined || right === undefined) {
      throw new Error('抽取恢复短语挑战词失败。');
    }
    order[i] = right;
    order[swapIndex] = left;
  }

  const indexes = order.slice(0, 3).sort((a, b) => a - b);
  return {
    indexes,
    words: indexes.map((index) => words[index] ?? ''),
  };
}

export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function checkRecoveryAnswers(challenge: RecoveryChallenge, answers: string[]): boolean {
  return challenge.words.every((word, index) => normalizeAnswer(answers[index] ?? '') === word);
}

export function validateNewPassphrase(passphrase: string): string | null {
  const length = Array.from(passphrase).length;
  if (length < 8) {
    return '启动密码至少需要 8 个字符。';
  }
  if (length > 1024) {
    return '启动密码过长。';
  }
  if (passphrase.trim().length === 0) {
    return '启动密码不能全是空白。';
  }
  return null;
}

export function validatePassphraseConfirmation(
  passphrase: string,
  confirmation: string,
): string | null {
  const baseIssue = validateNewPassphrase(passphrase);
  if (baseIssue !== null) {
    return baseIssue;
  }
  if (passphrase !== confirmation) {
    return '两次输入的启动密码不一致。';
  }
  return null;
}

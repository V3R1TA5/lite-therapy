import type { MemoRecord } from '../db/repositories/postSessionRepository.js';

export interface MemoSnapshot {
  version: 1;
  memoId: string;
  sourceSessionId: string;
  content: string;
  frozenAt: string;
}

export function buildMemoSnapshot(memo: MemoRecord, now: Date): MemoSnapshot {
  return {
    version: 1,
    memoId: memo.id,
    sourceSessionId: memo.sessionId,
    content: memo.content,
    frozenAt: now.toISOString(),
  };
}

export function serializeMemoSnapshot(snapshot: MemoSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseMemoSnapshot(raw: string | null): MemoSnapshot | null {
  if (raw === null || raw.trim().length === 0) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<MemoSnapshot>;
    if (
      value.version !== 1 ||
      typeof value.memoId !== 'string' ||
      typeof value.sourceSessionId !== 'string' ||
      typeof value.content !== 'string' ||
      value.content.trim().length === 0 ||
      typeof value.frozenAt !== 'string'
    ) {
      return null;
    }
    return {
      version: 1,
      memoId: value.memoId,
      sourceSessionId: value.sourceSessionId,
      content: value.content,
      frozenAt: value.frozenAt,
    };
  } catch {
    return null;
  }
}

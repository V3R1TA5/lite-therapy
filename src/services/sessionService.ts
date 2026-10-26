import { randomUUID } from 'node:crypto';
import { estimateTokens } from '../core/tokens.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  countUserMessages,
  insertMessage,
  listMessages,
  type MessageRecord,
} from '../db/repositories/messageRepository.js';
import {
  deleteSession as deleteSessionRow,
  getLastEndedSession,
  getMemorySnapshotJson,
  getOpenSession,
  getPromptSnapshotJson,
  getSession,
  insertSession,
  listSessions,
  type SessionRecord,
  setPromptSnapshot,
  setSessionStatus,
  touchSession,
  updateSessionTitle,
} from '../db/repositories/sessionRepository.js';
import {
  buildLegacyM2Snapshot,
  buildPromptSnapshot,
  type PromptSnapshot,
  parsePromptSnapshot,
  serializePromptSnapshot,
} from '../prompts/loader.js';
import { type MemoSnapshot, parseMemoSnapshot, serializeMemoSnapshot } from './memoSnapshot.js';

export const DEFAULT_SESSION_TITLE = '新会谈';
export const SESSION_OPENING = '我在这里。你可以慢慢说，想从哪里开始都可以。';
export const MAX_USER_MESSAGE_CHARS = 16_000;
export const MAX_USER_MESSAGE_TOKENS = 16_000;
export const SESSION_TITLE_LENGTH = 24;

export type SessionErrorCode =
  | 'SESSION_OPEN'
  | 'SESSION_NOT_FOUND'
  | 'NO_ENDED_SESSION'
  | 'INVALID_SESSION_STATE'
  | 'EMPTY_MESSAGE'
  | 'MESSAGE_TOO_LONG';

export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionError';
    this.code = code;
  }
}

export interface SessionServiceOptions {
  now?: () => Date;
  newId?: () => string;
  openingMessage?: string;
  maxUserMessageChars?: number;
  maxUserMessageTokens?: number;
  promptSnapshotFactory?: (now: Date) => PromptSnapshot;
}

export interface CreatedSession {
  session: SessionRecord;
  created: boolean;
}

/** 会话标题取首条用户消息前 24 个字符，并折叠空白。 */
export function makeSessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return DEFAULT_SESSION_TITLE;
  }
  const characters = Array.from(normalized).slice(0, SESSION_TITLE_LENGTH).join('');
  return characters.length > 0 ? characters : DEFAULT_SESSION_TITLE;
}

export class SessionService {
  private readonly db: DatabaseConnection;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly openingMessage: string;
  private readonly maxUserMessageChars: number;
  private readonly maxUserMessageTokens: number;
  private readonly promptSnapshotFactory: (now: Date) => PromptSnapshot;

  constructor(db: DatabaseConnection, options: SessionServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
    this.openingMessage = options.openingMessage ?? SESSION_OPENING;
    this.maxUserMessageChars = options.maxUserMessageChars ?? MAX_USER_MESSAGE_CHARS;
    this.maxUserMessageTokens = options.maxUserMessageTokens ?? MAX_USER_MESSAGE_TOKENS;
    this.promptSnapshotFactory = options.promptSnapshotFactory ?? buildPromptSnapshot;
  }

  getOpenSession(): SessionRecord | null {
    return getOpenSession(this.db);
  }

  getLastEndedSession(): SessionRecord | null {
    return getLastEndedSession(this.db);
  }

  getSession(id: string): SessionRecord | null {
    return getSession(this.db, id);
  }

  listSessions(limit = 50): SessionRecord[] {
    return listSessions(this.db, limit);
  }

  listMessages(sessionId: string, limit?: number): MessageRecord[] {
    return listMessages(this.db, sessionId, limit);
  }

  countUserMessages(sessionId: string): number {
    return countUserMessages(this.db, sessionId);
  }

  /**
   * 新会谈在创建时已经冻结快照。M2 旧会谈没有快照，首次继续时
   * 把当时的单一提示冻结为 legacy 层，避免静默套用新人格。
   */
  ensurePromptSnapshot(sessionId: string): PromptSnapshot {
    const existing = getPromptSnapshotJson(this.db, sessionId);
    if (existing !== null) {
      return parsePromptSnapshot(JSON.parse(existing) as unknown);
    }
    const session = getSession(this.db, sessionId);
    if (session === null) {
      throw new SessionError('SESSION_NOT_FOUND', '会谈不存在。');
    }
    const snapshot = buildLegacyM2Snapshot(this.now());
    setPromptSnapshot(
      this.db,
      sessionId,
      serializePromptSnapshot(snapshot),
      this.now().toISOString(),
    );
    return snapshot;
  }

  /** 供主页“新建会谈”使用；空 draft 会被清掉，活跃会谈则拒绝另开。 */
  ensureSession(): CreatedSession {
    const open = getOpenSession(this.db);
    if (open !== null) {
      return { session: open, created: false };
    }
    return { session: this.createSession(), created: true };
  }

  createSession(
    options: { memoSnapshot?: MemoSnapshot; memoryRecallEnabled?: boolean } = {},
  ): SessionRecord {
    const transaction = this.db.transaction(() => {
      const open = getOpenSession(this.db);
      if (open !== null) {
        if (open.status === 'draft' && countUserMessages(this.db, open.id) === 0) {
          deleteSessionRow(this.db, open.id);
        } else {
          throw new SessionError('SESSION_OPEN', '已经有一场未完成的会谈。');
        }
      }

      const now = this.now();
      const nowIso = now.toISOString();
      const snapshot = this.promptSnapshotFactory(now);
      const session = insertSession(this.db, {
        id: this.newId(),
        title: DEFAULT_SESSION_TITLE,
        status: 'draft',
        startedAt: nowIso,
        resumedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
        promptSnapshotJson: serializePromptSnapshot(snapshot),
        ...(options.memoSnapshot !== undefined
          ? { memorySnapshotJson: serializeMemoSnapshot(options.memoSnapshot) }
          : {}),
        ...(options.memoryRecallEnabled === false ? { memoryRecallEnabled: false } : {}),
      });
      insertMessage(this.db, {
        id: this.newId(),
        sessionId: session.id,
        role: 'assistant',
        content: this.openingMessage,
        status: 'complete',
        tokenEstimate: estimateTokens(this.openingMessage),
        createdAt: nowIso,
      });
      return session;
    });
    return transaction();
  }

  getMemoSnapshot(sessionId: string): MemoSnapshot | null {
    return parseMemoSnapshot(getMemorySnapshotJson(this.db, sessionId));
  }

  continueLastEnded(): SessionRecord {
    const open = getOpenSession(this.db);
    if (open !== null) {
      throw new SessionError('SESSION_OPEN', '先结束当前未完成的会谈。');
    }
    const ended = getLastEndedSession(this.db);
    if (ended === null) {
      throw new SessionError('NO_ENDED_SESSION', '没有可以继续的会谈。');
    }
    const nowIso = this.now().toISOString();
    this.ensurePromptSnapshot(ended.id);
    setSessionStatus(this.db, ended.id, 'active', nowIso, {
      resumedAt: nowIso,
      endedAt: null,
    });
    const resumed = getSession(this.db, ended.id);
    if (resumed === null) {
      throw new SessionError('SESSION_NOT_FOUND', '会谈不存在。');
    }
    return resumed;
  }

  endSession(id: string): { deleted: boolean; session: SessionRecord | null } {
    const transaction = this.db.transaction(() => {
      const session = getSession(this.db, id);
      if (session === null) {
        throw new SessionError('SESSION_NOT_FOUND', '会谈不存在。');
      }
      if (countUserMessages(this.db, id) === 0) {
        deleteSessionRow(this.db, id);
        return { deleted: true, session: null };
      }
      if (session.status === 'ended') {
        return { deleted: false, session };
      }
      const nowIso = this.now().toISOString();
      setSessionStatus(this.db, id, 'ended', nowIso, { endedAt: nowIso });
      return { deleted: false, session: getSession(this.db, id) };
    });
    return transaction();
  }

  deleteSession(id: string): boolean {
    return deleteSessionRow(this.db, id);
  }

  /** 启动时清理没有任何用户消息的草稿，避免留下只有开场的空会谈。 */
  cleanupEmptyDrafts(): number {
    const open = getOpenSession(this.db);
    if (open !== null && open.status === 'draft' && countUserMessages(this.db, open.id) === 0) {
      return deleteSessionRow(this.db, open.id) ? 1 : 0;
    }
    return 0;
  }

  appendUserMessage(sessionId: string, content: string): MessageRecord {
    const text = content.trim();
    if (text.length === 0) {
      throw new SessionError('EMPTY_MESSAGE', '消息不能为空。');
    }
    if (
      Array.from(text).length > this.maxUserMessageChars ||
      estimateTokens(text) > this.maxUserMessageTokens
    ) {
      throw new SessionError('MESSAGE_TOO_LONG', '这条消息太长了，请分成几次发送。');
    }

    const transaction = this.db.transaction(() => {
      const session = getSession(this.db, sessionId);
      if (session === null) {
        throw new SessionError('SESSION_NOT_FOUND', '会谈不存在。');
      }
      if (session.status === 'ended') {
        throw new SessionError('INVALID_SESSION_STATE', '会谈已经结束。');
      }

      const nowIso = this.now().toISOString();
      const message = insertMessage(this.db, {
        id: this.newId(),
        sessionId,
        role: 'user',
        content: text,
        status: 'complete',
        tokenEstimate: estimateTokens(text),
        createdAt: nowIso,
      });

      if (session.status === 'draft') {
        setSessionStatus(this.db, sessionId, 'active', nowIso, { resumedAt: nowIso });
      } else {
        touchSession(this.db, sessionId, nowIso);
      }
      if (session.title === DEFAULT_SESSION_TITLE) {
        updateSessionTitle(this.db, sessionId, makeSessionTitle(text), nowIso);
      }
      return message;
    });
    return transaction();
  }
}

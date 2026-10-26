import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { getPromptSnapshotJson, insertSession } from '../src/db/repositories/sessionRepository.js';
import { parsePromptSnapshot } from '../src/prompts/loader.js';
import type { MemoSnapshot } from '../src/services/memoSnapshot.js';
import {
  DEFAULT_SESSION_TITLE,
  makeSessionTitle,
  SessionService,
} from '../src/services/sessionService.js';

const KEY = Buffer.alloc(32, 4);
const roots: string[] = [];
const databases: DatabaseConnection[] = [];

interface Harness {
  db: DatabaseConnection;
  service: SessionService;
  setNow: (value: string) => void;
  nextId: string;
}

async function setup(
  options: { maxUserMessageChars?: number; maxUserMessageTokens?: number } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-sessions-'));
  roots.push(root);
  const db = openEncryptedDatabase(join(root, 'counsel.db'), KEY);
  databases.push(db);
  await runMigrations(db);

  let now = new Date('2026-10-26T10:00:00.000Z');
  let counter = 0;
  const service = new SessionService(db, {
    now: () => now,
    newId: () => {
      counter += 1;
      return 'id-' + counter;
    },
    ...(options.maxUserMessageChars !== undefined
      ? { maxUserMessageChars: options.maxUserMessageChars }
      : {}),
    ...(options.maxUserMessageTokens !== undefined
      ? { maxUserMessageTokens: options.maxUserMessageTokens }
      : {}),
  });
  return {
    db,
    service,
    setNow: (value: string) => {
      now = new Date(value);
    },
    get nextId() {
      counter += 1;
      return 'probe-' + counter;
    },
  };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('session titles', () => {
  it('collapses whitespace and limits to 24 characters', () => {
    expect(makeSessionTitle('  今天\n有点   累  ')).toBe('今天 有点 累');
    expect(makeSessionTitle('一'.repeat(30))).toHaveLength(24);
    expect(makeSessionTitle('   ')).toBe(DEFAULT_SESSION_TITLE);
  });
});

describe('SessionService', () => {
  it('creates a draft with an opening message and activates it on the first user message', async () => {
    const harness = await setup();
    const session = harness.service.createSession();

    expect(session.status).toBe('draft');
    expect(session.title).toBe(DEFAULT_SESSION_TITLE);
    const opening = harness.service.listMessages(session.id);
    expect(opening).toHaveLength(1);
    expect(opening[0]?.role).toBe('assistant');
    expect(opening[0]?.content).toContain('我在这里');

    harness.setNow('2026-10-26T10:05:00.000Z');
    const user = harness.service.appendUserMessage(
      session.id,
      '  今天有点累，想聊聊最近的工作和睡眠  ',
    );
    expect(user.role).toBe('user');
    expect(user.content).toBe('今天有点累，想聊聊最近的工作和睡眠');
    expect(user.tokenEstimate).toBeGreaterThan(0);

    const active = harness.service.getSession(session.id);
    expect(active?.status).toBe('active');
    expect(active?.title).toBe('今天有点累，想聊聊最近的工作和睡眠');
    expect(harness.service.listMessages(session.id)).toHaveLength(2);
  });

  it('deletes an empty draft when creating a new session and refuses to open a second active session', async () => {
    const harness = await setup();
    const first = harness.service.createSession();
    const second = harness.service.createSession();

    expect(harness.service.getSession(first.id)).toBeNull();
    expect(harness.service.getSession(second.id)?.status).toBe('draft');

    harness.service.appendUserMessage(second.id, '继续聊');
    expect(() => harness.service.createSession()).toThrow(
      expect.objectContaining({ code: 'SESSION_OPEN' }),
    );
    expect(harness.service.ensureSession()).toMatchObject({
      created: false,
      session: { id: second.id },
    });
  });

  it('deletes an empty session on end and ends a non-empty session', async () => {
    const harness = await setup();
    const empty = harness.service.createSession();
    const deleted = harness.service.endSession(empty.id);
    expect(deleted.deleted).toBe(true);
    expect(harness.service.getSession(empty.id)).toBeNull();

    const session = harness.service.createSession();
    harness.service.appendUserMessage(session.id, '想说说最近的事');
    harness.setNow('2026-10-26T11:00:00.000Z');
    const ended = harness.service.endSession(session.id);
    expect(ended.deleted).toBe(false);
    expect(ended.session?.status).toBe('ended');
    expect(ended.session?.endedAt).toBe('2026-10-26T11:00:00.000Z');
    expect(harness.service.getOpenSession()).toBeNull();
  });

  it('continues the last ended session and resets the active clock', async () => {
    const harness = await setup();
    const session = harness.service.createSession();
    harness.service.appendUserMessage(session.id, '第一次会谈');
    harness.service.endSession(session.id);
    harness.setNow('2026-10-28T09:00:00.000Z');

    const resumed = harness.service.continueLastEnded();
    expect(resumed.id).toBe(session.id);
    expect(resumed.status).toBe('active');
    expect(resumed.endedAt).toBeNull();
    expect(resumed.resumedAt).toBe('2026-10-28T09:00:00.000Z');

    expect(() => harness.service.continueLastEnded()).toThrow(
      expect.objectContaining({ code: 'SESSION_OPEN' }),
    );
  });

  it('deletes messages with the session and refuses messages after ending', async () => {
    const harness = await setup();
    const session = harness.service.createSession();
    harness.service.appendUserMessage(session.id, '有一句话');
    expect(harness.service.listMessages(session.id)).toHaveLength(2);
    expect(harness.service.deleteSession(session.id)).toBe(true);
    expect(harness.service.listMessages(session.id)).toHaveLength(0);

    const ended = harness.service.createSession();
    harness.service.appendUserMessage(ended.id, '结束前');
    harness.service.endSession(ended.id);
    expect(() => harness.service.appendUserMessage(ended.id, '结束后')).toThrow(
      expect.objectContaining({ code: 'INVALID_SESSION_STATE' }),
    );
  });

  it('rejects empty and oversized messages', async () => {
    const harness = await setup({ maxUserMessageChars: 8 });
    const session = harness.service.createSession();
    expect(() => harness.service.appendUserMessage(session.id, '   ')).toThrow(
      expect.objectContaining({ code: 'EMPTY_MESSAGE' }),
    );
    expect(() => harness.service.appendUserMessage(session.id, '一二三四五六七八九')).toThrow(
      expect.objectContaining({ code: 'MESSAGE_TOO_LONG' }),
    );

    const tokenHarness = await setup({ maxUserMessageTokens: 5 });
    const tokenSession = tokenHarness.service.createSession();
    expect(() =>
      tokenHarness.service.appendUserMessage(tokenSession.id, '这是一条超过五个 token 的消息'),
    ).toThrow(expect.objectContaining({ code: 'MESSAGE_TOO_LONG' }));
    expect(tokenHarness.service.listMessages(tokenSession.id)).toHaveLength(1);
  });

  it('enforces a single open session at the database level', async () => {
    const harness = await setup();
    const nowIso = '2026-10-26T10:00:00.000Z';
    insertSession(harness.db, {
      id: 'open-1',
      title: 'first',
      status: 'draft',
      startedAt: nowIso,
      resumedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    expect(() =>
      insertSession(harness.db, {
        id: 'open-2',
        title: 'second',
        status: 'active',
        startedAt: nowIso,
        resumedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
    ).toThrow(/only one open session/);
  });

  it('cleans up an empty draft on startup', async () => {
    const harness = await setup();
    const session = harness.service.createSession();
    expect(harness.service.cleanupEmptyDrafts()).toBe(1);
    expect(harness.service.getSession(session.id)).toBeNull();
    expect(harness.service.getOpenSession()).toBeNull();
  });

  it('freezes a prompt snapshot when creating a session', async () => {
    const harness = await setup();
    const session = harness.service.createSession();
    const json = getPromptSnapshotJson(harness.db, session.id);
    expect(json).not.toBeNull();
    const snapshot = parsePromptSnapshot(JSON.parse(json ?? 'null') as unknown);
    expect(snapshot.frozen.map((layer) => layer.id)).toContain('counselor/core');
    expect(snapshot.frozen.map((layer) => layer.id)).not.toContain('legacy/m2');
    expect(snapshot.hash).toHaveLength(64);
  });

  it('backfills a legacy M2 snapshot for old sessions without silently using the new persona', async () => {
    const harness = await setup();
    const nowIso = '2026-10-26T10:00:00.000Z';
    insertSession(harness.db, {
      id: 'legacy-session',
      title: '旧会谈',
      status: 'active',
      startedAt: nowIso,
      resumedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const first = harness.service.ensurePromptSnapshot('legacy-session');
    expect(first.frozen).toHaveLength(1);
    expect(first.frozen[0]?.id).toBe('legacy/m2');
    const second = harness.service.ensurePromptSnapshot('legacy-session');
    expect(second.hash).toBe(first.hash);
    expect(getPromptSnapshotJson(harness.db, 'legacy-session')).not.toBeNull();
  });

  it('can disable past memory recall for one session', async () => {
    const harness = await setup();
    const session = harness.service.createSession({ memoryRecallEnabled: false });
    expect(harness.service.getSession(session.id)?.memoryRecallEnabled).toBe(false);
    const normal = harness.service.createSession();
    expect(normal.memoryRecallEnabled).toBe(true);
  });

  it('freezes a memo snapshot into a new session', async () => {
    const harness = await setup();
    const memo: MemoSnapshot = {
      version: 1,
      memoId: 'memo-1',
      sourceSessionId: 'old-session',
      content: '主题：工作压力\n下次可以：谈边界。',
      frozenAt: '2026-10-26T09:00:00.000Z',
    };
    const session = harness.service.createSession({ memoSnapshot: memo });
    expect(harness.service.getMemoSnapshot(session.id)).toEqual(memo);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelProfile } from '../src/config/appConfig.js';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { listContextAudits } from '../src/db/repositories/contextAuditRepository.js';
import { insertMessage } from '../src/db/repositories/messageRepository.js';
import { getLatestRollingSummary } from '../src/db/repositories/summaryRepository.js';
import { type ContextBudgets, ContextService } from '../src/services/contextService.js';
import { SessionService } from '../src/services/sessionService.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const KEY = Buffer.alloc(32, 10);
const PROFILE: ModelProfile = {
  id: 'primary',
  label: 'Fake',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'fake-model',
};

const SMALL_BUDGETS: Partial<ContextBudgets> = {
  history: 100,
  summaryTrigger: 50,
  profile: 20,
  memo: 20,
  memory: 20,
  maxUserMessageTokens: 500,
  recentTarget: 30,
};

const roots: string[] = [];
const databases: DatabaseConnection[] = [];

interface Harness {
  db: DatabaseConnection;
  sessions: SessionService;
  context: ContextService;
  provider: ScriptedChatProvider;
  sessionId: string;
}

async function setup(
  runs: ConstructorParameters<typeof ScriptedChatProvider>[0] = [],
  budgets: Partial<ContextBudgets> = SMALL_BUDGETS,
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-context-'));
  roots.push(root);
  const db = openEncryptedDatabase(join(root, 'counsel.db'), KEY);
  databases.push(db);
  await runMigrations(db);

  let counter = 0;
  const newId = () => {
    counter += 1;
    return 'id-' + counter;
  };
  const now = new Date('2026-10-26T12:00:00.000Z');
  const sessions = new SessionService(db, { now: () => now, newId });
  const session = sessions.createSession();
  const provider = new ScriptedChatProvider(runs);
  const context = new ContextService({
    db,
    sessions,
    profile: PROFILE,
    provider,
    budgets,
    now: () => now,
    newId,
  });
  return { db, sessions, context, provider, sessionId: session.id };
}

function addMessage(
  harness: Harness,
  role: 'user' | 'assistant',
  content: string,
  tokenEstimate: number,
): string {
  const id = 'history-' + role + '-' + Math.random().toString(16).slice(2);
  insertMessage(harness.db, {
    id,
    sessionId: harness.sessionId,
    role,
    content,
    tokenEstimate,
    createdAt: '2026-10-26T12:01:00.000Z',
    status: 'complete',
  });
  return id;
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ContextService', () => {
  it('keeps short histories intact without summarizing', async () => {
    const harness = await setup([], { ...SMALL_BUDGETS, summaryTrigger: 100 });
    addMessage(harness, 'user', '最近有点累', 10);
    addMessage(harness, 'assistant', '听起来很不容易', 10);
    const currentId = addMessage(harness, 'user', '今晚也睡不好', 10);

    const result = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
    });

    expect(result.audit.truncated).toBe(false);
    expect(result.audit.summaryUsed).toBe(false);
    expect(result.audit.historyMessages).toBe(4);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'base system' });
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '今晚也睡不好' });
    expect(result.messages.some((message) => message.content === 'base system')).toBe(true);
    expect(harness.provider.requests).toHaveLength(0);
    expect(currentId).toBeTruthy();
  });

  it('truncates older messages and warns when summary generation fails', async () => {
    const harness = await setup([[{ type: 'done' }]]);
    addMessage(harness, 'user', '很早的事', 30);
    addMessage(harness, 'assistant', '很早的回应', 30);
    addMessage(harness, 'user', '中间的事', 30);
    addMessage(harness, 'assistant', '中间的回应', 30);
    addMessage(harness, 'user', '当前最想说的事', 10);

    const result = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
    });

    expect(result.audit.truncated).toBe(true);
    expect(result.audit.summaryUsed).toBe(false);
    expect(result.audit.warnings).toContain('summary_failed');
    expect(result.audit.warnings).toContain('history_truncated_without_summary');
    expect(result.audit.historyTokens).toBeLessThanOrEqual(100);
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '当前最想说的事' });
    expect(harness.provider.requests).toHaveLength(1);
  });

  it('summarizes older messages and injects the summary when available', async () => {
    const harness = await setup([
      [{ type: 'delta', text: '较早的对话：工作压力与睡眠。' }, { type: 'done' }],
    ]);
    addMessage(harness, 'user', '很早的事', 30);
    addMessage(harness, 'assistant', '很早的回应', 30);
    addMessage(harness, 'user', '中间的事', 30);
    addMessage(harness, 'assistant', '中间的回应', 30);
    addMessage(harness, 'user', '当前最想说的事', 10);

    const result = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
    });
    expect(result.audit.truncated).toBe(true);
    expect(result.audit.summaryUsed).toBe(true);
    expect(result.audit.warnings).toContain('history_truncated');
    expect(result.messages.some((message) => message.content.includes('滚动摘要'))).toBe(true);
    expect(result.messages.some((message) => message.content.includes('工作压力'))).toBe(true);
    expect(result.audit.entries.some((entry) => !entry.included)).toBe(true);
    expect(result.audit.entries.some((entry) => entry.included)).toBe(true);
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '当前最想说的事' });

    const stored = getLatestRollingSummary(harness.db, harness.sessionId);
    expect(stored?.content).toContain('工作压力');
    expect(stored?.coveredUntilMessageId).toBeTruthy();
  });

  it('updates an existing summary incrementally', async () => {
    const harness = await setup([
      [{ type: 'delta', text: '第一版摘要' }, { type: 'done' }],
      [{ type: 'delta', text: '第二版摘要' }, { type: 'done' }],
    ]);
    addMessage(harness, 'user', '旧一', 30);
    addMessage(harness, 'assistant', '旧回应一', 30);
    addMessage(harness, 'user', '旧二', 30);
    addMessage(harness, 'assistant', '旧回应二', 30);
    addMessage(harness, 'user', '当前一', 10);

    const first = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
    });
    expect(first.audit.summaryUsed).toBe(true);

    addMessage(harness, 'assistant', '新的回应', 30);
    addMessage(harness, 'user', '当前二', 10);
    const second = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
    });

    expect(second.audit.summaryUsed).toBe(true);
    expect(harness.provider.requests.length).toBeGreaterThanOrEqual(2);
    const secondRequest = harness.provider.requests[1];
    expect(secondRequest?.messages[1]?.content).toContain('第一版摘要');
    const stored = getLatestRollingSummary(harness.db, harness.sessionId);
    expect(stored?.content).toContain('第二版摘要');
  });

  it('keeps more recent messages and the old summary when an incremental summary fails', async () => {
    const harness = await setup([
      [{ type: 'delta', text: '第一版摘要' }, { type: 'done' }],
      [{ type: 'done' }],
    ]);
    addMessage(harness, 'user', '旧一', 30);
    addMessage(harness, 'assistant', '旧回应一', 30);
    addMessage(harness, 'user', '旧二', 30);
    addMessage(harness, 'assistant', '旧回应二', 30);
    addMessage(harness, 'user', '当前一', 10);

    const first = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
    });
    expect(first.audit.summaryUsed).toBe(true);

    addMessage(harness, 'assistant', '新的回应', 30);
    addMessage(harness, 'user', '当前二', 10);
    addMessage(harness, 'assistant', '更近的回应', 30);
    addMessage(harness, 'user', '当前三', 10);
    const second = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
    });

    expect(second.audit.summaryUsed).toBe(false);
    expect(second.audit.warnings).toContain('summary_failed');
    expect(second.messages.some((message) => message.content.includes('滚动摘要'))).toBe(false);
    expect(second.audit.historyTokens).toBeGreaterThan(first.audit.historyTokens);
    expect(second.messages.at(-1)).toEqual({ role: 'user', content: '当前三' });
    const stored = getLatestRollingSummary(harness.db, harness.sessionId);
    expect(stored?.content).toContain('第一版摘要');
  });

  it('applies profile, memo and memory budgets and records audit metadata', async () => {
    const harness = await setup([], {
      ...SMALL_BUDGETS,
      profile: 8,
      memo: 20,
      memory: 20,
    });
    addMessage(harness, 'user', '短消息', 5);

    const result = await harness.context.build({
      sessionId: harness.sessionId,
      systemPrompt: 'base system',
      profileText: '来访者自述：这是一个很长很长的称呼与背景信息，需要被预算裁剪。',
      memoText: '上次留下的短备忘录。',
      memoryCards: ['喜欢在晚上聊天'],
    });

    expect(result.audit.memoUsed).toBe(true);
    expect(result.audit.memoryUsed).toBe(true);
    expect(result.audit.warnings).toContain('profile_truncated');
    expect(result.messages.some((message) => message.content.includes('冻结的备忘录'))).toBe(true);
    expect(result.messages.some((message) => message.content.includes('记忆卡'))).toBe(true);

    harness.context.persistAudit(result.audit, 'assistant-1');
    const audits = listContextAudits(harness.db, harness.sessionId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.messageId).toBe('assistant-1');
    expect(audits[0]?.memoUsed).toBe(true);
    expect(audits[0]?.warnings).toContain('profile_truncated');
    expect(audits[0]?.entries.length).toBeGreaterThan(0);
    expect(audits[0]?.entries.at(-1)?.role).toBe('user');
    expect(audits[0]?.entries.every((entry) => entry.included)).toBe(true);
    expect(JSON.stringify(audits[0])).not.toContain('上次留下的短备忘录');
  });

  it('rejects a current message over the hard token limit', async () => {
    const harness = await setup([], { ...SMALL_BUDGETS, maxUserMessageTokens: 5 });
    addMessage(harness, 'user', '这条消息很大', 50);

    await expect(
      harness.context.build({
        sessionId: harness.sessionId,
        systemPrompt: 'base system',
      }),
    ).rejects.toMatchObject({ code: 'MESSAGE_TOO_LARGE' });
  });
});

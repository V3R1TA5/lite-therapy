import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelProfile } from '../src/config/appConfig.js';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { listContextAudits } from '../src/db/repositories/contextAuditRepository.js';
import { insertMemoryCard, listMemoryRecalls } from '../src/db/repositories/memoryRepository.js';
import {
  insertMessage,
  listMessages,
  type MessageRecord,
} from '../src/db/repositories/messageRepository.js';
import { sumUsageForSession } from '../src/db/repositories/modelUsageRepository.js';
import { ChatProviderError } from '../src/providers/types.js';
import { ChatService, type ChatServiceOptions } from '../src/services/chatService.js';
import { memoryTextHash } from '../src/services/memoryService.js';
import type {
  SafetyEvaluation,
  SafetyEvaluationInput,
  SafetyEvaluator,
} from '../src/services/safetyService.js';
import { SessionService } from '../src/services/sessionService.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const KEY = Buffer.alloc(32, 6);
const PROFILE: ModelProfile = {
  id: 'primary',
  label: 'Test',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
};

interface Harness {
  db: DatabaseConnection;
  sessions: SessionService;
  chat: ChatService;
  provider: ScriptedChatProvider;
  sessionId: string;
  setNow: (value: Date) => void;
}

const roots: string[] = [];
const databases: DatabaseConnection[] = [];

async function setup(
  runs: ConstructorParameters<typeof ScriptedChatProvider>[0],
  options: {
    delayMs?: number;
    maxHistoryMessages?: number;
    safety?: SafetyEvaluator;
    memoText?: string;
    memoryEnabled?: boolean;
    includeSensitiveMemory?: boolean;
  } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-chat-'));
  roots.push(root);
  const db = openEncryptedDatabase(join(root, 'counsel.db'), KEY);
  databases.push(db);
  await runMigrations(db);

  let now = new Date('2026-10-26T12:00:00.000Z');
  let counter = 0;
  const newId = () => {
    counter += 1;
    return 'id-' + counter;
  };
  const sessions = new SessionService(db, { now: () => now, newId });
  const session = sessions.createSession();
  const provider = new ScriptedChatProvider(runs, {
    ...(options.delayMs !== undefined ? { delayMs: options.delayMs } : {}),
  });
  const chatOptions: ChatServiceOptions = {
    db,
    sessions,
    profile: PROFILE,
    provider,
    now: () => now,
    newId,
    flushIntervalMs: 0,
    ...(options.maxHistoryMessages !== undefined
      ? { maxHistoryMessages: options.maxHistoryMessages }
      : {}),
    ...(options.safety !== undefined ? { safety: options.safety } : {}),
    ...(options.memoText !== undefined ? { memoText: options.memoText } : {}),
    ...(options.memoryEnabled !== undefined ? { memoryEnabled: options.memoryEnabled } : {}),
    ...(options.includeSensitiveMemory !== undefined
      ? { includeSensitiveMemory: options.includeSensitiveMemory }
      : {}),
  };
  const chat = new ChatService(chatOptions);
  return {
    db,
    sessions,
    chat,
    provider,
    sessionId: session.id,
    setNow: (value: Date) => {
      now = value;
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

describe('ChatService', () => {
  it('streams a reply and persists both messages with usage', async () => {
    const harness = await setup([
      [
        { type: 'delta', text: '你' },
        { type: 'delta', text: '好' },
        { type: 'usage', promptTokens: 20, completionTokens: 2 },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    const events: string[] = [];
    let accumulated = '';
    const result = await harness.chat.send(harness.sessionId, '今天有点累', {
      onUserMessage: (message: MessageRecord) => events.push('user:' + message.content),
      onAssistantStart: () => events.push('start'),
      onDelta: (text, all) => {
        accumulated = all;
        events.push('delta:' + text);
      },
      onDone: () => events.push('done'),
    });

    expect(result.status).toBe('done');
    expect(events).toEqual(['user:今天有点累', 'start', 'delta:你', 'delta:好', 'done']);
    expect(accumulated).toBe('你好');

    const messages = listMessages(harness.db, harness.sessionId);
    expect(messages).toHaveLength(3);
    const assistant = messages[2];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.status).toBe('complete');
    expect(assistant?.content).toBe('你好');
    expect(assistant?.tokenEstimate).toBeGreaterThan(0);

    const session = harness.sessions.getSession(harness.sessionId);
    expect(session?.status).toBe('active');
    expect(session?.title).toBe('今天有点累');

    const usage = sumUsageForSession(harness.db, harness.sessionId);
    expect(usage.promptTokens).toBe(20);
    expect(usage.completionTokens).toBe(2);

    const audits = listContextAudits(harness.db, harness.sessionId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.messageId).toBe(assistant?.id);
    expect(audits[0]?.truncated).toBe(false);

    const request = harness.provider.requests[0];
    expect(request?.messages[0]?.role).toBe('system');
    expect(request?.messages[0]?.content).toContain('AI');
    expect(request?.messages[0]?.content).toContain('诊断');
    expect(request?.messages.at(-1)).toEqual({ role: 'user', content: '今天有点累' });
  });

  it('stops generation and keeps the partial reply as interrupted', async () => {
    const harness = await setup(
      [
        [
          { type: 'delta', text: '第一' },
          { type: 'delta', text: '第二' },
          { type: 'delta', text: '第三' },
          { type: 'done' },
        ],
      ],
      { delayMs: 5 },
    );

    const captured: { message: MessageRecord | null } = { message: null };
    const result = await harness.chat.send(harness.sessionId, '慢慢说', {
      onDelta: (_text, accumulated) => {
        if (accumulated === '第一') {
          harness.chat.abort();
        }
      },
      onAborted: (message) => {
        captured.message = message;
      },
    });

    expect(result.status).toBe('aborted');
    expect(captured.message?.status).toBe('interrupted');
    expect(captured.message?.content).toBe('第一');
    expect(harness.chat.isStreaming).toBe(false);
  });

  it('persists partial content and reports provider errors', async () => {
    const harness = await setup([
      [
        { type: 'delta', text: '半句' },
        new ChatProviderError('NETWORK', '无法连接模型服务：连接被拒绝'),
      ],
    ]);

    const captured: { text: string; message: MessageRecord | null } = {
      text: '',
      message: null,
    };
    const result = await harness.chat.send(harness.sessionId, '在吗', {
      onError: (error, message) => {
        captured.text = error;
        captured.message = message;
      },
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('无法连接');
    expect(captured.text).toContain('无法连接');
    expect(captured.message?.status).toBe('failed');
    expect(captured.message?.content).toBe('半句');

    const messages = listMessages(harness.db, harness.sessionId);
    expect(messages.at(-1)?.status).toBe('failed');
    expect(messages.at(-1)?.content).toBe('半句');
  });

  it('retries by replacing the last assistant reply without duplicating the user message', async () => {
    const harness = await setup([
      [{ type: 'delta', text: '第一版' }, { type: 'done' }],
      [{ type: 'delta', text: '第二版' }, { type: 'done' }],
    ]);

    const first = await harness.chat.send(harness.sessionId, '再说一次');
    expect(first.message?.content).toBe('第一版');
    expect(listMessages(harness.db, harness.sessionId)).toHaveLength(3);

    const second = await harness.chat.retryLast(harness.sessionId);
    expect(second.status).toBe('done');
    expect(second.message?.content).toBe('第二版');

    const messages = listMessages(harness.db, harness.sessionId);
    expect(messages).toHaveLength(3);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(messages.at(-1)?.content).toBe('第二版');
  });

  it('caps the history sent to the provider and keeps the newest message', async () => {
    const harness = await setup([[{ type: 'delta', text: '好' }, { type: 'done' }]], {
      maxHistoryMessages: 6,
    });

    for (let index = 0; index < 10; index += 1) {
      insertMessage(harness.db, {
        id: 'history-' + index,
        sessionId: harness.sessionId,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: '历史 ' + index,
        createdAt: '2026-10-26T12:00:00.000Z',
      });
    }

    await harness.chat.send(harness.sessionId, '最新一条');
    const request = harness.provider.requests[0];
    expect(request?.messages).toHaveLength(7);
    expect(request?.messages[0]?.role).toBe('system');
    expect(request?.messages.at(-1)?.content).toBe('最新一条');
    expect(request?.messages.some((message) => message.content === '历史 0')).toBe(false);
  });

  it('refuses concurrent sends and retries without any user message', async () => {
    const harness = await setup([[{ type: 'delta', text: '慢' }, { type: 'done' }]], {
      delayMs: 10,
    });

    const first = harness.chat.send(harness.sessionId, '第一条');
    await expect(harness.chat.send(harness.sessionId, '第二条')).rejects.toMatchObject({
      code: 'BUSY',
    });
    harness.chat.abort();
    await first;

    const fresh = await setup([[{ type: 'done' }]]);
    await expect(fresh.chat.retryLast(fresh.sessionId)).rejects.toMatchObject({
      code: 'NO_USER_MESSAGE',
    });
  });

  it('adds risk emphasis to the system prompt and marks the assistant message', async () => {
    const calls: SafetyEvaluationInput[] = [];
    const safety: SafetyEvaluator = {
      evaluate: async (input): Promise<SafetyEvaluation> => {
        calls.push(input);
        return {
          level: 'imminent',
          detector: 'rule+model',
          category: 'suicide',
          context: 'self',
          ambiguous: false,
          classifierFailed: false,
          ruleCount: 1,
          confidence: 0.9,
        };
      },
    };
    const harness = await setup([[{ type: 'delta', text: '我在。' }, { type: 'done' }]], {
      safety,
    });

    const risks: string[] = [];
    const result = await harness.chat.send(harness.sessionId, '我今晚准备自杀', {
      onRisk: (evaluation) => risks.push(evaluation.level),
    });

    expect(risks).toEqual(['imminent']);
    expect(result.message?.riskLevel).toBe('imminent');
    expect(calls[0]?.messageId).toBeTruthy();
    const request = harness.provider.requests[0];
    expect(request?.messages[0]?.content).toContain('立即安全');
    expect(request?.messages[0]?.content).toContain('本轮强化安全强调');
  });

  it('re-evaluates risk when retrying', async () => {
    let calls = 0;
    const safety: SafetyEvaluator = {
      evaluate: async (): Promise<SafetyEvaluation> => {
        calls += 1;
        return {
          level: 'concern',
          detector: 'rule',
          category: 'suicide',
          ambiguous: false,
          classifierFailed: false,
          ruleCount: 1,
        };
      },
    };
    const harness = await setup(
      [
        [{ type: 'delta', text: '第一版' }, { type: 'done' }],
        [{ type: 'delta', text: '第二版' }, { type: 'done' }],
      ],
      { safety },
    );

    await harness.chat.send(harness.sessionId, '我不想活了');
    await harness.chat.retryLast(harness.sessionId);

    expect(calls).toBe(2);
    expect(harness.provider.requests[1]?.messages[0]?.content).toContain('本轮额外安全强调');
  });

  it('injects a frozen memo and records memo_used in the audit', async () => {
    const harness = await setup([[{ type: 'delta', text: '我在。' }, { type: 'done' }]], {
      memoText: '主题：工作压力\n下次可以：谈边界。',
    });
    await harness.chat.send(harness.sessionId, '这周还是在加班');
    const request = harness.provider.requests[0];
    expect(request?.messages.some((message) => message.content.includes('冻结的备忘录'))).toBe(
      true,
    );
    expect(request?.messages.some((message) => message.content.includes('工作压力'))).toBe(true);
    const audits = listContextAudits(harness.db, harness.sessionId);
    expect(audits[0]?.memoUsed).toBe(true);
  });

  it('recalls normal memory cards into context and logs the recall', async () => {
    const harness = await setup([[{ type: 'delta', text: '我在。' }, { type: 'done' }]]);
    const opening = harness.sessions.listMessages(harness.sessionId)[0];
    expect(opening).toBeDefined();
    const textValue = '工作压力反复出现';
    insertMemoryCard(harness.db, {
      id: 'memory-1',
      kind: 'theme',
      text: textValue,
      textHash: memoryTextHash(textValue),
      sourceSessionId: harness.sessionId,
      sourceMessageIds: [opening?.id ?? ''],
      confidence: 0.8,
      sensitivity: 'normal',
      tags: ['工作'],
      uncertain: false,
      model: 'fake-model',
      promptVersion: 'memory-v1',
      createdAt: '2026-10-25T12:00:00.000Z',
    });

    await harness.chat.send(harness.sessionId, '最近工作压力很大');
    const request = harness.provider.requests[0];
    expect(request?.messages.some((message) => message.content.includes('记忆卡'))).toBe(true);
    expect(request?.messages.some((message) => message.content.includes('工作压力反复出现'))).toBe(
      true,
    );
    expect(listContextAudits(harness.db, harness.sessionId)[0]?.memoryUsed).toBe(true);
    expect(listMemoryRecalls(harness.db, harness.sessionId)).toHaveLength(1);
  });

  it('does not recall memory when the global memory switch is off', async () => {
    const harness = await setup([[{ type: 'delta', text: '我在。' }, { type: 'done' }]], {
      memoryEnabled: false,
    });
    const opening = harness.sessions.listMessages(harness.sessionId)[0];
    const textValue = '工作压力反复出现';
    insertMemoryCard(harness.db, {
      id: 'memory-off',
      kind: 'theme',
      text: textValue,
      textHash: memoryTextHash(textValue),
      sourceSessionId: harness.sessionId,
      sourceMessageIds: [opening?.id ?? ''],
      confidence: 0.8,
      sensitivity: 'normal',
      tags: [],
      uncertain: false,
      model: 'fake-model',
      promptVersion: 'memory-v1',
      createdAt: '2026-10-25T12:00:00.000Z',
    });
    await harness.chat.send(harness.sessionId, '最近工作压力很大');
    expect(
      harness.provider.requests[0]?.messages.some((message) =>
        message.content.includes('工作压力反复出现'),
      ),
    ).toBe(false);
    expect(listContextAudits(harness.db, harness.sessionId)[0]?.memoryUsed).toBe(false);
  });

  it('recalls sensitive memory only when explicitly enabled', async () => {
    const harness = await setup([[{ type: 'delta', text: '我在。' }, { type: 'done' }]], {
      includeSensitiveMemory: true,
    });
    const opening = harness.sessions.listMessages(harness.sessionId)[0];
    const textValue = '工作压力让我想起家里';
    insertMemoryCard(harness.db, {
      id: 'memory-sensitive',
      kind: 'theme',
      text: textValue,
      textHash: memoryTextHash(textValue),
      sourceSessionId: harness.sessionId,
      sourceMessageIds: [opening?.id ?? ''],
      confidence: 0.8,
      sensitivity: 'sensitive',
      tags: [],
      uncertain: false,
      model: 'fake-model',
      promptVersion: 'memory-v1',
      createdAt: '2026-10-25T12:00:00.000Z',
    });
    await harness.chat.send(harness.sessionId, '最近工作压力很大');
    expect(
      harness.provider.requests[0]?.messages.some((message) =>
        message.content.includes('工作压力让我想起家里'),
      ),
    ).toBe(true);
  });
});

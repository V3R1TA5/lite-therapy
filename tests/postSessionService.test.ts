import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelProfile } from '../src/config/appConfig.js';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { listMemoryCards } from '../src/db/repositories/memoryRepository.js';
import {
  getLatestCaseFormulation,
  getLatestReadyMemo,
  getLatestSessionNote,
  getLatestSupervision,
  listLetters,
  resetRunningPostSessionJobs,
  setJobRunning,
} from '../src/db/repositories/postSessionRepository.js';
import { PostSessionService } from '../src/services/postSessionService.js';
import { SessionService } from '../src/services/sessionService.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const KEY = Buffer.alloc(32, 11);
const PROFILE: ModelProfile = {
  id: 'primary',
  label: 'Fake',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'fake-model',
};

const VALID_MEMO = [
  '主题：工作压力与睡眠',
  '重要背景：最近连续加班，晚上难以入睡。',
  '偏好与资源：愿意尝试固定睡前流程，也信任一位朋友。',
  '未完成：还没有决定是否和主管谈工作量。',
  '下次可以：先谈睡眠与边界的取舍。',
].join('\n');

const roots: string[] = [];
const databases: DatabaseConnection[] = [];

interface Harness {
  db: DatabaseConnection;
  sessions: SessionService;
  service: PostSessionService;
  provider: ScriptedChatProvider;
  sessionId: string;
}

async function setup(
  runs: ConstructorParameters<typeof ScriptedChatProvider>[0],
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-post-'));
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
  sessions.appendUserMessage(session.id, '最近工作压力很大，晚上睡不好。');
  sessions.endSession(session.id);
  const provider = new ScriptedChatProvider(runs);
  const service = new PostSessionService({
    db,
    sessions,
    provider,
    profile: PROFILE,
    displayName: '小林',
    now: () => now,
    newId,
    timeoutMs: 1000,
    retryDelaysMs: [0, 0, 0],
  });
  return { db, sessions, service, provider, sessionId: session.id };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('PostSessionService', () => {
  it('runs six tasks serially and persists products', async () => {
    const harness = await setup([
      [{ type: 'delta', text: '主题：工作压力\n情绪：疲惫' }, { type: 'done' }],
      [{ type: 'delta', text: '纵向理解：工作压力与自我价值反复纠缠。' }, { type: 'done' }],
      [{ type: 'delta', text: '督导：注意别急着给建议。' }, { type: 'done' }],
      [{ type: 'delta', text: VALID_MEMO }, { type: 'done' }],
      [{ type: 'delta', text: '小林，谢谢你愿意说到这里。' }, { type: 'done' }],
      [
        {
          type: 'delta',
          text: JSON.stringify([
            {
              kind: 'theme',
              text: '工作压力反复出现',
              source_message_ids: ['id-3'],
              confidence: 0.8,
              sensitivity: 'normal',
              tags: ['工作'],
            },
          ]),
        },
        { type: 'done' },
      ],
    ]);

    const jobs = harness.service.enqueue(harness.sessionId);
    expect(jobs).toHaveLength(6);
    expect(jobs.map((job) => job.kind)).toEqual([
      'session_note',
      'case_formulation',
      'supervision',
      'memo',
      'letter',
      'memory',
    ]);

    const result = await harness.service.run(harness.sessionId);
    expect(result.stale).toBe(false);
    expect(result.jobs.every((job) => job.status === 'ready')).toBe(true);
    expect(getLatestSessionNote(harness.db, harness.sessionId)?.content).toContain('工作压力');
    expect(getLatestCaseFormulation(harness.db, 'zhiwei')?.version).toBe(1);
    expect(getLatestCaseFormulation(harness.db, 'zhiwei')?.content).toContain('自我价值');
    expect(getLatestSupervision(harness.db, harness.sessionId)?.content).toContain('督导');
    expect(getLatestReadyMemo(harness.db, 'zhiwei')?.content).toContain('下次可以');
    expect(listLetters(harness.db)).toHaveLength(1);
    expect(listLetters(harness.db)[0]?.content).toContain('谢谢你');
    expect(listMemoryCards(harness.db)).toHaveLength(1);
    expect(listMemoryCards(harness.db)[0]?.text).toContain('工作压力');

    const memoRequest = harness.provider.requests[3];
    expect(memoRequest?.messages[1]?.content).toContain('督导意见');
    expect(memoRequest?.maxTokens).toBe(3000);
    expect(harness.provider.requests[5]?.maxTokens).toBe(3000);
  });

  it('marks jobs stale when the session is continued before publishing', async () => {
    const harness = await setup([]);
    harness.service.enqueue(harness.sessionId);
    harness.sessions.continueLastEnded();

    const result = await harness.service.run(harness.sessionId);
    expect(result.stale).toBe(true);
    expect(result.jobs.every((job) => job.status === 'stale')).toBe(true);
    expect(getLatestSessionNote(harness.db, harness.sessionId)).toBeNull();
    expect(getLatestReadyMemo(harness.db, 'zhiwei')).toBeNull();
    expect(listLetters(harness.db)).toHaveLength(0);
  });

  it('fails an invalid memo without blocking the letter', async () => {
    const harness = await setup([
      [{ type: 'delta', text: '主题：工作压力' }, { type: 'done' }],
      [{ type: 'delta', text: '纵向理解：工作压力。' }, { type: 'done' }],
      [{ type: 'delta', text: '督导：放慢。' }, { type: 'done' }],
      [{ type: 'delta', text: '这是一份没有结构标题的备忘录。' }, { type: 'done' }],
      [{ type: 'delta', text: '这是一份没有结构标题的备忘录。' }, { type: 'done' }],
      [{ type: 'delta', text: '这是一份没有结构标题的备忘录。' }, { type: 'done' }],
      [{ type: 'delta', text: '这封信仍然写给你。' }, { type: 'done' }],
      [{ type: 'delta', text: '[]' }, { type: 'done' }],
    ]);
    harness.service.enqueue(harness.sessionId);

    const result = await harness.service.run(harness.sessionId);
    const byKind = new Map(result.jobs.map((job) => [job.kind, job]));
    expect(byKind.get('session_note')?.status).toBe('ready');
    expect(byKind.get('case_formulation')?.status).toBe('ready');
    expect(byKind.get('supervision')?.status).toBe('ready');
    expect(byKind.get('memo')?.status).toBe('failed');
    expect(byKind.get('letter')?.status).toBe('ready');
    expect(getLatestReadyMemo(harness.db, 'zhiwei')).toBeNull();
    expect(listLetters(harness.db)).toHaveLength(1);
  });

  it('resets interrupted running jobs to queued so they can resume', async () => {
    const harness = await setup([]);
    const jobs = harness.service.enqueue(harness.sessionId);
    const first = jobs[0];
    expect(first).toBeDefined();
    setJobRunning(harness.db, first?.id ?? '', '2026-10-26T12:01:00.000Z');
    expect(harness.service.listJobs(harness.sessionId)[0]?.status).toBe('running');
    resetRunningPostSessionJobs(harness.db);
    expect(harness.service.listJobs(harness.sessionId)[0]?.status).toBe('queued');
  });

  it('retries a failed task with backoff and then continues the queue', async () => {
    const harness = await setup([
      [new Error('临时网络错误')],
      [new Error('临时网络错误')],
      [{ type: 'delta', text: '主题：工作压力' }, { type: 'done' }],
      [{ type: 'delta', text: '纵向理解：工作压力。' }, { type: 'done' }],
      [{ type: 'delta', text: '督导：放慢。' }, { type: 'done' }],
      [{ type: 'delta', text: VALID_MEMO }, { type: 'done' }],
      [{ type: 'delta', text: '来信正文' }, { type: 'done' }],
      [{ type: 'delta', text: '[]' }, { type: 'done' }],
    ]);
    harness.service.enqueue(harness.sessionId);
    const result = await harness.service.run(harness.sessionId);
    const note = result.jobs.find((job) => job.kind === 'session_note');
    expect(note?.status).toBe('ready');
    expect(note?.attempts).toBe(3);
    expect(getLatestSessionNote(harness.db, harness.sessionId)?.content).toContain('工作压力');
  });
});

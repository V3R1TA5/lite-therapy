import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelProfile } from '../src/config/appConfig.js';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations/index.js';
import {
  clearMemoryCards,
  confirmMemoryCard,
  getMemoryCard,
  insertMemoryCard,
  listMemoryCards,
  listMemoryRecalls,
  listMemoryRevisions,
  searchMemoryCards,
  updateMemoryCardText,
} from '../src/db/repositories/memoryRepository.js';
import { MemoryService, memoryTextHash } from '../src/services/memoryService.js';
import { SessionService } from '../src/services/sessionService.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const KEY = Buffer.alloc(32, 12);
const PROFILE: ModelProfile = {
  id: 'primary',
  label: 'Fake',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'fake-model',
};

const roots: string[] = [];
const databases: DatabaseConnection[] = [];

interface Harness {
  db: DatabaseConnection;
  sessionId: string;
  userId: string;
}

async function setup(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-memory-'));
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
  const userMessage = sessions.listMessages(session.id).find((message) => message.role === 'user');
  if (userMessage === undefined) {
    throw new Error('missing user message');
  }
  return { db, sessionId: session.id, userId: userMessage.id };
}

function makeService(
  harness: Harness,
  runs: ConstructorParameters<typeof ScriptedChatProvider>[0],
): MemoryService {
  const provider = new ScriptedChatProvider(runs);
  let counter = 0;
  return new MemoryService({
    db: harness.db,
    provider,
    profile: PROFILE,
    now: () => new Date('2026-10-26T12:00:00.000Z'),
    newId: () => {
      counter += 1;
      return 'memory-' + counter;
    },
    timeoutMs: 1000,
  });
}

function cardJson(harness: Harness, text: string, sensitivity: string = 'normal'): object {
  return {
    kind: 'theme',
    text,
    source_message_ids: [harness.userId],
    confidence: 0.8,
    sensitivity,
    tags: ['工作'],
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

describe('MemoryService', () => {
  it('extracts valid cards and rejects diagnosis or missing sources', async () => {
    const harness = await setup();
    const service = makeService(harness, [
      [
        {
          type: 'delta',
          text: JSON.stringify([
            cardJson(harness, '工作压力反复出现'),
            {
              kind: 'fact',
              text: '你患有抑郁症',
              source_message_ids: [harness.userId],
              confidence: 0.9,
              sensitivity: 'normal',
              tags: [],
            },
            {
              kind: 'fact',
              text: '没有来源的条目',
              source_message_ids: ['missing'],
              confidence: 0.8,
              sensitivity: 'normal',
              tags: [],
            },
            {
              ...cardJson(harness, '希望被称呼为小林', 'sensitive'),
              kind: 'preference',
            },
          ]),
        },
        { type: 'done' },
      ],
    ]);

    const inserted = await service.extract(harness.sessionId);
    expect(inserted).toHaveLength(2);
    expect(listMemoryCards(harness.db)).toHaveLength(2);
    expect(getMemoryCard(harness.db, 'missing')).toBeNull();
    expect(listMemoryCards(harness.db).some((card) => card.text.includes('抑郁症'))).toBe(false);
  });

  it('deduplicates text and filters sensitive cards from recall', async () => {
    const harness = await setup();
    const service = makeService(harness, [
      [
        {
          type: 'delta',
          text: JSON.stringify([
            cardJson(harness, '工作压力反复出现'),
            cardJson(harness, '工作压力让我想起家里', 'sensitive'),
          ]),
        },
        { type: 'done' },
      ],
      [
        {
          type: 'delta',
          text: JSON.stringify([cardJson(harness, '工作压力反复出现。')]),
        },
        { type: 'done' },
      ],
    ]);

    expect(await service.extract(harness.sessionId)).toHaveLength(2);
    expect(await service.extract(harness.sessionId)).toHaveLength(0);
    expect(listMemoryCards(harness.db)).toHaveLength(2);

    const recalled = await service.recall(harness.sessionId, '工作压力', harness.userId);
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.sensitivity).toBe('normal');
    expect(listMemoryRecalls(harness.db, harness.sessionId)).toHaveLength(1);
    const stored = listMemoryCards(harness.db).find((card) => card.id === recalled[0]?.id);
    expect(stored?.recallCount).toBe(1);

    clearMemoryCards(harness.db);
    expect(listMemoryCards(harness.db)).toHaveLength(0);
    expect(searchMemoryCards(harness.db, '工作压力')).toHaveLength(0);
  });

  it('marks similar but non-identical memories as uncertain and excludes them from recall', async () => {
    const harness = await setup();
    const service = makeService(harness, [
      [
        { type: 'delta', text: JSON.stringify([cardJson(harness, '工作压力反复出现')]) },
        { type: 'done' },
      ],
      [
        {
          type: 'delta',
          text: JSON.stringify([cardJson(harness, '工作压力反复出现很严重')]),
        },
        { type: 'done' },
      ],
    ]);

    await service.extract(harness.sessionId);
    await service.extract(harness.sessionId);
    const cards = listMemoryCards(harness.db);
    const conflict = cards.find((card) => card.text.includes('很严重'));
    expect(conflict?.uncertain).toBe(true);
    await expect(
      service.recall(harness.sessionId, '工作压力', harness.userId),
    ).resolves.toHaveLength(1);

    if (conflict !== undefined) {
      confirmMemoryCard(harness.db, conflict.id);
      expect(getMemoryCard(harness.db, conflict.id)?.uncertain).toBe(false);
    }
  });

  it('records the previous text when a memory card is edited', async () => {
    const harness = await setup();
    const service = makeService(harness, [
      [
        { type: 'delta', text: JSON.stringify([cardJson(harness, '工作压力反复出现')]) },
        { type: 'done' },
      ],
    ]);
    await service.extract(harness.sessionId);
    const card = listMemoryCards(harness.db)[0];
    expect(card).toBeDefined();
    if (card === undefined) {
      return;
    }
    updateMemoryCardText(
      harness.db,
      card.id,
      '工作压力仍然反复出现',
      memoryTextHash('工作压力仍然反复出现'),
    );
    const revisions = listMemoryRevisions(harness.db, card.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.previousText).toBe('工作压力反复出现');
    expect(revisions[0]?.newText).toBe('工作压力仍然反复出现');
  });

  it('ranks cards by how much of the card text the query covers', async () => {
    const harness = await setup();
    const service = makeService(harness, []);
    const base = {
      kind: 'theme' as const,
      sourceSessionId: harness.sessionId,
      sourceMessageIds: [harness.userId],
      confidence: 0.8,
      sensitivity: 'normal' as const,
      tags: [],
      uncertain: false,
      model: PROFILE.model,
      promptVersion: 'v1',
      createdAt: '2026-10-26T12:00:00.000Z',
    };
    insertMemoryCard(harness.db, {
      ...base,
      id: 'memory-broad',
      text: '工作压力反复出现',
      textHash: memoryTextHash('工作压力反复出现'),
    });
    insertMemoryCard(harness.db, {
      ...base,
      id: 'memory-exact',
      text: '工作压力',
      textHash: memoryTextHash('工作压力'),
    });

    const recalled = await service.recall(harness.sessionId, '工作压力', harness.userId);
    expect(recalled[0]?.id).toBe('memory-exact');
    expect(listMemoryRecalls(harness.db, harness.sessionId)[0]?.reason).toBe('fts5+coverage');
  });

  it('uses provider embeddings to recall cards without lexical overlap', async () => {
    const harness = await setup();
    const provider = {
      async *stream() {
        yield {
          type: 'delta' as const,
          text: JSON.stringify([
            cardJson(harness, '工作压力反复出现'),
            cardJson(harness, '家庭关系紧张'),
          ]),
        };
        yield { type: 'done' as const };
      },
      async embed(request: { input: string[] }) {
        return request.input.map((value) =>
          value.includes('工作') || value.includes('职业') ? [1, 0] : [0, 1],
        );
      },
    };
    const service = new MemoryService({
      db: harness.db,
      provider,
      profile: PROFILE,
      embeddingModel: 'embed-test',
      now: () => new Date('2026-10-26T12:00:00.000Z'),
      newId: () => 'embed-memory-' + Math.random().toString(16).slice(2),
      timeoutMs: 1000,
    });
    await service.extract(harness.sessionId);
    expect(listMemoryCards(harness.db).every((card) => card.embedding !== null)).toBe(true);

    const recalled = await service.recall(harness.sessionId, '职业', harness.userId);
    expect(recalled[0]?.text).toBe('工作压力反复出现');
    expect(listMemoryRecalls(harness.db, harness.sessionId)[0]?.reason).toBe(
      'fts5+coverage+embedding',
    );
  });

  it('backfills vectors only for normal cards and skips sensitive ones', async () => {
    const harness = await setup();
    const base = {
      kind: 'theme' as const,
      sourceSessionId: harness.sessionId,
      sourceMessageIds: [harness.userId],
      confidence: 0.8,
      tags: [],
      uncertain: false,
      model: PROFILE.model,
      promptVersion: 'v1',
      createdAt: '2026-10-26T12:00:00.000Z',
    };
    insertMemoryCard(harness.db, {
      ...base,
      id: 'normal-card',
      text: '工作压力',
      textHash: memoryTextHash('工作压力'),
      sensitivity: 'normal',
    });
    insertMemoryCard(harness.db, {
      ...base,
      id: 'sensitive-card',
      text: '敏感的工作压力',
      textHash: memoryTextHash('敏感的工作压力'),
      sensitivity: 'sensitive',
    });
    const chatProvider = {
      async *stream() {
        yield { type: 'done' as const };
      },
    };
    let embeddingBaseUrl = '';
    let embeddingApiKey: string | undefined;
    const embeddingProvider = {
      async *stream() {
        yield { type: 'done' as const };
      },
      async embed(request: { input: string[]; profile: { baseUrl: string }; apiKey?: string }) {
        embeddingBaseUrl = request.profile.baseUrl;
        embeddingApiKey = request.apiKey;
        return request.input.map(() => [0.5, 0.5]);
      },
    };
    const service = new MemoryService({
      db: harness.db,
      provider: chatProvider,
      profile: PROFILE,
      embeddingProvider,
      embeddingProfile: { ...PROFILE, baseUrl: 'http://127.0.0.1:11434/v1' },
      embeddingApiKey: null,
      embeddingModel: 'embed-test',
      now: () => new Date('2026-10-26T12:00:00.000Z'),
      timeoutMs: 1000,
    });
    await expect(service.backfillEmbeddings()).resolves.toBe(1);
    expect(embeddingBaseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(embeddingApiKey).toBeUndefined();
    expect(getMemoryCard(harness.db, 'normal-card')?.embedding).toEqual([0.5, 0.5]);
    expect(getMemoryCard(harness.db, 'sensitive-card')?.embedding).toBeNull();
  });
});

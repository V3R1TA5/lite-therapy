import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { listMessages } from '../src/db/repositories/messageRepository.js';
import { listRiskEvents } from '../src/db/repositories/riskRepository.js';
import { SafetyService } from '../src/services/safetyService.js';
import { SessionService } from '../src/services/sessionService.js';
import { FakeRiskClassifier } from './helpers/fakeRiskClassifier.js';

const KEY = Buffer.alloc(32, 9);
const roots: string[] = [];
const databases: DatabaseConnection[] = [];

interface Harness {
  db: DatabaseConnection;
  sessions: SessionService;
  safety: SafetyService;
  classifier: FakeRiskClassifier;
  sessionId: string;
}

async function setup(
  classifierResults: Array<{
    ok: boolean;
    level?: 'none' | 'concern' | 'imminent';
    confidence?: number;
    category?: 'suicide';
  }>,
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-safety-'));
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
  const classifier = new FakeRiskClassifier(classifierResults);
  const safety = new SafetyService({
    db,
    classifier,
    now: () => now,
    newId,
  });
  return { db, sessions, safety, classifier, sessionId: session.id };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('SafetyService', () => {
  it('does not call the classifier or write events for benign messages', async () => {
    const harness = await setup([]);
    const message = harness.sessions.appendUserMessage(
      harness.sessionId,
      '今天天气不错，想聊聊工作',
    );
    const result = await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: message.id,
      text: message.content,
    });

    expect(result).toMatchObject({ level: 'none', detector: 'none', ruleCount: 0 });
    expect(harness.classifier.calls).toHaveLength(0);
    expect(listRiskEvents(harness.db, harness.sessionId)).toHaveLength(0);
  });

  it('keeps rule concern when the classifier says none', async () => {
    const harness = await setup([{ ok: true, level: 'none', confidence: 0.2 }]);
    const message = harness.sessions.appendUserMessage(harness.sessionId, '我最近真的不想活了');
    const result = await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: message.id,
      text: message.content,
    });

    expect(result).toMatchObject({ level: 'concern', detector: 'rule', category: 'suicide' });
    const events = listRiskEvents(harness.db, harness.sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]?.contextJson).not.toContain('不想活');
    expect(harness.sessions.getSession(harness.sessionId)?.riskState).toBe('concern');
    expect(
      listMessages(harness.db, harness.sessionId).find((item) => item.id === message.id)?.riskLevel,
    ).toBe('concern');
  });

  it('lets the classifier raise unequivocal concern to imminent', async () => {
    const harness = await setup([
      { ok: true, level: 'imminent', confidence: 0.9, category: 'suicide' },
    ]);
    const message = harness.sessions.appendUserMessage(harness.sessionId, '我今晚准备自杀');
    const result = await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: message.id,
      text: message.content,
    });

    expect(result.level).toBe('imminent');
    expect(result.detector).toBe('rule+model');
    expect(harness.sessions.getSession(harness.sessionId)?.riskState).toBe('imminent');
  });

  it('falls back to the rule level when classification fails', async () => {
    const harness = await setup([{ ok: false }]);
    const message = harness.sessions.appendUserMessage(harness.sessionId, '我今晚准备自杀');
    const result = await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: message.id,
      text: message.content,
    });

    expect(result).toMatchObject({
      level: 'imminent',
      detector: 'rule-fallback',
      classifierFailed: true,
    });
  });

  it('uses the classifier for ambiguous expressions', async () => {
    const harness = await setup([
      { ok: true, level: 'concern', confidence: 0.6, category: 'suicide' },
    ]);
    const message = harness.sessions.appendUserMessage(harness.sessionId, '活着很累，感觉没有希望');
    const result = await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: message.id,
      text: message.content,
    });

    expect(result).toMatchObject({
      level: 'concern',
      detector: 'model',
      ambiguous: true,
    });
    expect(harness.classifier.calls).toHaveLength(1);
  });

  it('does not downgrade ambiguous expressions after an earlier concern', async () => {
    const harness = await setup([
      { ok: true, level: 'none', confidence: 0.2 },
      { ok: true, level: 'none', confidence: 0.2 },
    ]);
    const first = harness.sessions.appendUserMessage(harness.sessionId, '我不想活了');
    await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: first.id,
      text: first.content,
    });

    const second = harness.sessions.appendUserMessage(harness.sessionId, '有时候觉得很空洞');
    const result = await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: second.id,
      text: second.content,
    });

    expect(result.level).toBe('concern');
    expect(harness.sessions.getSession(harness.sessionId)?.riskState).toBe('concern');
  });

  it('keeps a prior imminent session state without re-triggering on benign text', async () => {
    const harness = await setup([{ ok: true, level: 'imminent', confidence: 0.9 }]);
    const first = harness.sessions.appendUserMessage(harness.sessionId, '我今晚准备自杀');
    await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: first.id,
      text: first.content,
    });

    const second = harness.sessions.appendUserMessage(harness.sessionId, '我今天吃了面条');
    const result = await harness.safety.evaluate({
      sessionId: harness.sessionId,
      messageId: second.id,
      text: second.content,
    });

    expect(result.level).toBe('none');
    expect(harness.sessions.getSession(harness.sessionId)?.riskState).toBe('imminent');
    expect(listRiskEvents(harness.db, harness.sessionId)).toHaveLength(1);
  });
});

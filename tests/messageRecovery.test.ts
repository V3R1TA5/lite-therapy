import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type DatabaseConnection, openEncryptedDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations/index.js';
import {
  insertMessage,
  listMessages,
  recoverStreamingMessages,
} from '../src/db/repositories/messageRepository.js';
import { insertSession } from '../src/db/repositories/sessionRepository.js';

const KEY = Buffer.alloc(32, 8);
const roots: string[] = [];
const databases: DatabaseConnection[] = [];

async function setup(): Promise<DatabaseConnection> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-recovery-'));
  roots.push(root);
  const db = openEncryptedDatabase(join(root, 'counsel.db'), KEY);
  databases.push(db);
  await runMigrations(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('message recovery', () => {
  it('marks leftover streaming replies as interrupted and leaves complete messages alone', async () => {
    const db = await setup();
    const now = '2026-10-26T10:00:00.000Z';
    insertSession(db, {
      id: 'session-1',
      title: 'test',
      status: 'active',
      startedAt: now,
      resumedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    insertMessage(db, {
      id: 'm1',
      sessionId: 'session-1',
      role: 'user',
      content: '你好',
      status: 'complete',
      createdAt: now,
    });
    insertMessage(db, {
      id: 'm2',
      sessionId: 'session-1',
      role: 'assistant',
      content: '半截回复',
      status: 'streaming',
      createdAt: now,
    });

    expect(recoverStreamingMessages(db)).toBe(1);
    const messages = listMessages(db, 'session-1');
    expect(messages.find((message) => message.id === 'm1')?.status).toBe('complete');
    expect(messages.find((message) => message.id === 'm2')?.status).toBe('interrupted');
    expect(messages.find((message) => message.id === 'm2')?.content).toBe('半截回复');
    expect(recoverStreamingMessages(db)).toBe(0);
  });
});

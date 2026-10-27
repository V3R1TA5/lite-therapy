import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../database.js';

export const MEMORY_KINDS = [
  'fact',
  'theme',
  'relationship',
  'preference',
  'risk_resource',
  'unfinished',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SENSITIVITIES = ['normal', 'sensitive', 'restricted'] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];
export type MemoryStatus = 'active' | 'archived' | 'deleted';

export interface MemoryCardRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  textHash: string;
  sourceSessionId: string | null;
  sourceMessageIds: string[];
  confidence: number;
  sensitivity: MemorySensitivity;
  tags: string[];
  status: MemoryStatus;
  uncertain: boolean;
  embedding: number[] | null;
  model: string;
  promptVersion: string;
  createdAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
}

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  text: string;
  text_hash: string;
  source_session_id: string | null;
  source_message_ids_json: string;
  confidence: number;
  sensitivity: MemorySensitivity;
  tags_json: string;
  embedding: Buffer | string | null;
  status: MemoryStatus;
  uncertain: number;
  model: string;
  prompt_version: string;
  created_at: string;
  last_recalled_at: string | null;
  recall_count: number;
}

const COLUMNS =
  'id, kind, text, text_hash, source_session_id, source_message_ids_json, confidence, sensitivity, tags_json, embedding, status, uncertain, model, prompt_version, created_at, last_recalled_at, recall_count';

function mapCard(row: MemoryRow): MemoryCardRecord {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    textHash: row.text_hash,
    sourceSessionId: row.source_session_id,
    sourceMessageIds: JSON.parse(row.source_message_ids_json) as string[],
    confidence: row.confidence,
    sensitivity: row.sensitivity,
    tags: JSON.parse(row.tags_json) as string[],
    status: row.status,
    uncertain: row.uncertain === 1,
    embedding:
      row.embedding === null
        ? null
        : (JSON.parse(
            typeof row.embedding === 'string' ? row.embedding : row.embedding.toString('utf8'),
          ) as number[]),
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
    lastRecalledAt: row.last_recalled_at,
    recallCount: row.recall_count,
  };
}

export interface MemoryRevisionRecord {
  id: string;
  memoryId: string;
  previousText: string;
  newText: string;
  changedAt: string;
}

export interface InsertMemoryCardInput {
  id: string;
  kind: MemoryKind;
  text: string;
  textHash: string;
  sourceSessionId: string;
  sourceMessageIds: string[];
  confidence: number;
  sensitivity: MemorySensitivity;
  tags: string[];
  uncertain: boolean;
  embedding?: number[] | null;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export function insertMemoryCard(db: DatabaseConnection, input: InsertMemoryCardInput): void {
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO memory_cards
         (id, kind, text, text_hash, source_session_id, source_message_ids_json, confidence,
          sensitivity, tags_json, embedding, status, uncertain, model, prompt_version,
          created_at, last_recalled_at, recall_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, 0)`,
    ).run(
      input.id,
      input.kind,
      input.text,
      input.textHash,
      input.sourceSessionId,
      JSON.stringify(input.sourceMessageIds),
      input.confidence,
      input.sensitivity,
      JSON.stringify(input.tags),
      input.embedding === undefined || input.embedding === null
        ? null
        : Buffer.from(JSON.stringify(input.embedding), 'utf8'),
      input.uncertain ? 1 : 0,
      input.model,
      input.promptVersion,
      input.createdAt,
    );
    db.prepare('DELETE FROM memory_cards_fts WHERE memory_id = ?').run(input.id);
    db.prepare('INSERT INTO memory_cards_fts (text, tags, memory_id) VALUES (?, ?, ?)').run(
      input.text,
      input.tags.join(' '),
      input.id,
    );
  });
  transaction();
}

export function getMemoryCard(db: DatabaseConnection, id: string): MemoryCardRecord | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM memory_cards WHERE id = ?`).get(id) as
    | MemoryRow
    | undefined;
  return row ? mapCard(row) : null;
}

export function findMemoryByHash(
  db: DatabaseConnection,
  textHash: string,
): MemoryCardRecord | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM memory_cards
       WHERE text_hash = ? AND status != 'deleted' LIMIT 1`,
    )
    .get(textHash) as MemoryRow | undefined;
  return row ? mapCard(row) : null;
}

export interface ListMemoryOptions {
  kind?: MemoryKind;
  status?: MemoryStatus;
  limit?: number;
}

export function listMemoryCards(
  db: DatabaseConnection,
  options: ListMemoryOptions = {},
): MemoryCardRecord[] {
  const where: string[] = ['status != ?'];
  const params: unknown[] = ['deleted'];
  if (options.status !== undefined) {
    where[0] = 'status = ?';
    params[0] = options.status;
  }
  if (options.kind !== undefined) {
    where.push('kind = ?');
    params.push(options.kind);
  }
  params.push(options.limit ?? 100);
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM memory_cards WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(...params) as MemoryRow[];
  return rows.map(mapCard);
}

export function searchMemoryCards(
  db: DatabaseConnection,
  query: string,
  limit = 20,
): MemoryCardRecord[] {
  const cleaned = query
    .replace(/["'*:^()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 3) {
    return [];
  }
  // trigram 分词下整句不会命中；拆成三字片段做 OR，召回后再排序。
  const compact = cleaned.replace(/\s+/g, '');
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= compact.length && grams.size < 30; index += 1) {
    grams.add(compact.slice(index, index + 3));
  }
  const ftsQuery =
    grams.size > 0
      ? [...grams].map((gram) => '"' + gram.replace(/"/g, '""') + '"').join(' OR ')
      : cleaned;
  try {
    const rows = db
      .prepare(
        `SELECT ${COLUMNS.split(', ')
          .map((column) => 'c.' + column)
          .join(', ')}
         FROM memory_cards_fts f JOIN memory_cards c ON c.id = f.memory_id
         WHERE memory_cards_fts MATCH ? AND c.status = 'active'
         ORDER BY bm25(memory_cards_fts) LIMIT ?`,
      )
      .all(ftsQuery, limit) as MemoryRow[];
    return rows.map(mapCard);
  } catch {
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM memory_cards
         WHERE status = 'active' AND text LIKE ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all('%' + cleaned + '%', limit) as MemoryRow[];
    return rows.map(mapCard);
  }
}

export function updateMemoryCardText(
  db: DatabaseConnection,
  id: string,
  text: string,
  textHash: string,
): void {
  const transaction = db.transaction(() => {
    const previous = getMemoryCard(db, id);
    db.prepare(
      'UPDATE memory_cards SET text = ?, text_hash = ?, embedding = NULL WHERE id = ?',
    ).run(text, textHash, id);
    const tags = db.prepare('SELECT tags_json FROM memory_cards WHERE id = ?').get(id) as
      | { tags_json: string }
      | undefined;
    const tagText = tags === undefined ? '' : (JSON.parse(tags.tags_json) as string[]).join(' ');
    db.prepare('DELETE FROM memory_cards_fts WHERE memory_id = ?').run(id);
    db.prepare('INSERT INTO memory_cards_fts (text, tags, memory_id) VALUES (?, ?, ?)').run(
      text,
      tagText,
      id,
    );
    if (previous !== null && previous.text !== text) {
      db.prepare(
        `INSERT INTO memory_card_revisions
           (id, memory_id, previous_text, new_text, changed_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), id, previous.text, text, new Date().toISOString());
    }
  });
  transaction();
}

export function listMemoryRevisions(
  db: DatabaseConnection,
  memoryId: string,
  limit = 20,
): MemoryRevisionRecord[] {
  const rows = db
    .prepare(
      `SELECT id, memory_id, previous_text, new_text, changed_at
       FROM memory_card_revisions WHERE memory_id = ?
       ORDER BY changed_at DESC, rowid DESC LIMIT ?`,
    )
    .all(memoryId, limit) as Array<{
    id: string;
    memory_id: string;
    previous_text: string;
    new_text: string;
    changed_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    memoryId: row.memory_id,
    previousText: row.previous_text,
    newText: row.new_text,
    changedAt: row.changed_at,
  }));
}

export function confirmMemoryCard(db: DatabaseConnection, id: string): void {
  db.prepare('UPDATE memory_cards SET uncertain = 0 WHERE id = ?').run(id);
}

export function archiveMemoryCard(db: DatabaseConnection, id: string): void {
  db.prepare("UPDATE memory_cards SET status = 'archived' WHERE id = ?").run(id);
}

export function deleteMemoryCard(db: DatabaseConnection, id: string): void {
  const transaction = db.transaction(() => {
    db.prepare("UPDATE memory_cards SET status = 'deleted' WHERE id = ?").run(id);
    db.prepare('DELETE FROM memory_cards_fts WHERE memory_id = ?').run(id);
  });
  transaction();
}

export function listMemoryCardsForSession(
  db: DatabaseConnection,
  sessionId: string,
): MemoryCardRecord[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM memory_cards
       WHERE source_session_id = ? AND status = 'active'
       ORDER BY created_at, rowid`,
    )
    .all(sessionId) as MemoryRow[];
  return rows.map(mapCard);
}

export function deleteMemoryCards(db: DatabaseConnection, ids: string[]): void {
  if (ids.length === 0) {
    return;
  }
  const transaction = db.transaction(() => {
    const mark = db.prepare("UPDATE memory_cards SET status = 'deleted' WHERE id = ?");
    const unindex = db.prepare('DELETE FROM memory_cards_fts WHERE memory_id = ?');
    for (const id of ids) {
      mark.run(id);
      unindex.run(id);
    }
  });
  transaction();
}

export function clearMemoryCards(db: DatabaseConnection): void {
  const transaction = db.transaction(() => {
    db.prepare("UPDATE memory_cards SET status = 'deleted' WHERE status != 'deleted'").run();
    db.prepare('DELETE FROM memory_cards_fts').run();
  });
  transaction();
}

export function countMemoriesForSession(db: DatabaseConnection, sessionId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM memory_cards WHERE source_session_id = ? AND status = 'active'",
    )
    .get(sessionId) as { count: number };
  return row.count;
}

export function deleteMemoriesForSession(db: DatabaseConnection, sessionId: string): void {
  const rows = db
    .prepare('SELECT id FROM memory_cards WHERE source_session_id = ? AND status != ?')
    .all(sessionId, 'deleted') as Array<{ id: string }>;
  deleteMemoryCards(
    db,
    rows.map((row) => row.id),
  );
}

export function clearMemoryEmbeddings(db: DatabaseConnection): number {
  const result = db
    .prepare('UPDATE memory_cards SET embedding = NULL WHERE embedding IS NOT NULL')
    .run();
  return result.changes;
}

export function updateMemoryEmbedding(
  db: DatabaseConnection,
  id: string,
  embedding: number[] | null,
): void {
  db.prepare('UPDATE memory_cards SET embedding = ? WHERE id = ?').run(
    embedding === null ? null : Buffer.from(JSON.stringify(embedding), 'utf8'),
    id,
  );
}

export function markMemoryRecalled(db: DatabaseConnection, id: string, recalledAt: string): void {
  db.prepare(
    'UPDATE memory_cards SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?',
  ).run(recalledAt, id);
}

export interface MemoryRecallRecord {
  id: string;
  sessionId: string;
  messageId: string | null;
  memoryId: string;
  score: number;
  reason: string;
  createdAt: string;
}

export function recordMemoryRecall(
  db: DatabaseConnection,
  input: Omit<MemoryRecallRecord, 'createdAt'> & { createdAt: string },
): void {
  db.prepare(
    `INSERT INTO memory_recalls
       (id, session_id, message_id, memory_id, score, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.messageId,
    input.memoryId,
    input.score,
    input.reason,
    input.createdAt,
  );
}

export function listRecallsForMemory(
  db: DatabaseConnection,
  memoryId: string,
  limit = 5,
): MemoryRecallRecord[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, message_id, memory_id, score, reason, created_at
       FROM memory_recalls WHERE memory_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(memoryId, limit) as Array<{
    id: string;
    session_id: string;
    message_id: string | null;
    memory_id: string;
    score: number;
    reason: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    memoryId: row.memory_id,
    score: row.score,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export function listMemoryRecalls(
  db: DatabaseConnection,
  sessionId: string,
  limit = 20,
): MemoryRecallRecord[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, message_id, memory_id, score, reason, created_at
       FROM memory_recalls WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(sessionId, limit) as Array<{
    id: string;
    session_id: string;
    message_id: string | null;
    memory_id: string;
    score: number;
    reason: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    memoryId: row.memory_id,
    score: row.score,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

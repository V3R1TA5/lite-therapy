import type { DatabaseConnection } from '../database.js';

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'complete' | 'streaming' | 'interrupted' | 'failed';

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  tokenEstimate: number;
  riskLevel: string;
  metaJson: string;
  createdAt: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  status: string;
  token_estimate: number;
  risk_level: string;
  meta_json: string;
  created_at: string;
}

const COLUMNS =
  'id, session_id, role, content, status, token_estimate, risk_level, meta_json, created_at';

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MessageRole,
    content: row.content,
    status: row.status as MessageStatus,
    tokenEstimate: row.token_estimate,
    riskLevel: row.risk_level,
    metaJson: row.meta_json,
    createdAt: row.created_at,
  };
}

export interface InsertMessageInput {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  tokenEstimate?: number;
  riskLevel?: string;
  metaJson?: string;
  createdAt: string;
}

export function insertMessage(db: DatabaseConnection, input: InsertMessageInput): MessageRecord {
  db.prepare(
    `INSERT INTO messages
       (id, session_id, role, content, status, token_estimate, risk_level, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.role,
    input.content,
    input.status ?? 'complete',
    input.tokenEstimate ?? 0,
    input.riskLevel ?? 'none',
    input.metaJson ?? '{}',
    input.createdAt,
  );
  const message = getMessage(db, input.id);
  if (message === null) {
    throw new Error('消息写入后无法读回。');
  }
  return message;
}

export function getMessage(db: DatabaseConnection, id: string): MessageRecord | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM messages WHERE id = ?`).get(id) as
    | MessageRow
    | undefined;
  return row ? mapMessage(row) : null;
}

export function listMessages(
  db: DatabaseConnection,
  sessionId: string,
  limit?: number,
): MessageRecord[] {
  const rows =
    limit === undefined
      ? (db
          .prepare(`SELECT ${COLUMNS} FROM messages WHERE session_id = ? ORDER BY rowid ASC`)
          .all(sessionId) as MessageRow[])
      : (
          db
            .prepare(
              `SELECT ${COLUMNS} FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT ?`,
            )
            .all(sessionId, limit) as MessageRow[]
        ).reverse();
  return rows.map(mapMessage);
}

export function getLastMessage(db: DatabaseConnection, sessionId: string): MessageRecord | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT 1`)
    .get(sessionId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function getLastAssistantMessage(
  db: DatabaseConnection,
  sessionId: string,
): MessageRecord | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 1`,
    )
    .get(sessionId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function updateMessageContent(
  db: DatabaseConnection,
  id: string,
  content: string,
  status?: MessageStatus,
  tokenEstimate?: number,
): void {
  if (status === undefined) {
    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
    return;
  }
  db.prepare('UPDATE messages SET content = ?, status = ?, token_estimate = ? WHERE id = ?').run(
    content,
    status,
    tokenEstimate ?? 0,
    id,
  );
}

export function updateMessageStatus(
  db: DatabaseConnection,
  id: string,
  status: MessageStatus,
): void {
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
}

export function updateMessageRiskLevel(
  db: DatabaseConnection,
  id: string,
  riskLevel: string,
): void {
  db.prepare('UPDATE messages SET risk_level = ? WHERE id = ?').run(riskLevel, id);
}

export function updateMessageMeta(db: DatabaseConnection, id: string, metaJson: string): void {
  db.prepare('UPDATE messages SET meta_json = ? WHERE id = ?').run(metaJson, id);
}

export function deleteMessage(db: DatabaseConnection, id: string): boolean {
  const result = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return result.changes > 0;
}

export function countUserMessages(db: DatabaseConnection, sessionId: string): number {
  const row = db
    .prepare("SELECT count(*) AS n FROM messages WHERE session_id = ? AND role = 'user'")
    .get(sessionId) as { n: number };
  return row.n;
}

/** 崩溃或断电后，把仍在 streaming 的助手消息收尾，避免界面一直转圈。 */
export function recoverStreamingMessages(db: DatabaseConnection): number {
  const result = db
    .prepare("UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'")
    .run();
  return result.changes;
}

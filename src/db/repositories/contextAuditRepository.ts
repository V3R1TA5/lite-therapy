import type { DatabaseConnection } from '../database.js';

export type ContextAuditRole = 'user' | 'assistant';

export interface ContextAuditEntry {
  messageId: string;
  role: ContextAuditRole;
  tokens: number;
  included: boolean;
}

export interface ContextAuditInput {
  id: string;
  sessionId: string;
  messageId: string | null;
  promptTokens: number;
  historyTokens: number;
  historyMessages: number;
  truncated: boolean;
  summaryUsed: boolean;
  memoUsed: boolean;
  memoryUsed: boolean;
  warnings: string[];
  entries: ContextAuditEntry[];
  createdAt: string;
}

export interface ContextAuditRecord extends ContextAuditInput {
  warnings: string[];
}

interface AuditRow {
  id: string;
  session_id: string;
  message_id: string | null;
  prompt_tokens: number;
  history_tokens: number;
  history_messages: number;
  truncated: number;
  summary_used: number;
  memo_used: number;
  memory_used: number;
  warnings_json: string;
  entries_json: string;
  created_at: string;
}

export function insertContextAudit(db: DatabaseConnection, input: ContextAuditInput): void {
  db.prepare(
    `INSERT INTO context_audits
       (id, session_id, message_id, prompt_tokens, history_tokens, history_messages,
        truncated, summary_used, memo_used, memory_used, warnings_json, entries_json,
        created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.messageId,
    input.promptTokens,
    input.historyTokens,
    input.historyMessages,
    input.truncated ? 1 : 0,
    input.summaryUsed ? 1 : 0,
    input.memoUsed ? 1 : 0,
    input.memoryUsed ? 1 : 0,
    JSON.stringify(input.warnings),
    JSON.stringify(input.entries),
    input.createdAt,
  );
}

export function listContextAudits(
  db: DatabaseConnection,
  sessionId: string,
  limit = 20,
): ContextAuditRecord[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, message_id, prompt_tokens, history_tokens, history_messages,
              truncated, summary_used, memo_used, memory_used, warnings_json, entries_json,
              created_at
       FROM context_audits WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(sessionId, limit) as AuditRow[];
  return rows.reverse().map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    promptTokens: row.prompt_tokens,
    historyTokens: row.history_tokens,
    historyMessages: row.history_messages,
    truncated: row.truncated === 1,
    summaryUsed: row.summary_used === 1,
    memoUsed: row.memo_used === 1,
    memoryUsed: row.memory_used === 1,
    warnings: JSON.parse(row.warnings_json) as string[],
    entries: JSON.parse(row.entries_json) as ContextAuditEntry[],
    createdAt: row.created_at,
  }));
}

import type { DatabaseConnection } from '../database.js';

export interface RollingSummaryRecord {
  id: string;
  sessionId: string;
  coveredUntilMessageId: string | null;
  content: string;
  model: string;
  createdAt: string;
}

interface SummaryRow {
  id: string;
  session_id: string;
  covered_until_message_id: string | null;
  content: string;
  model: string;
  created_at: string;
}

function mapRow(row: SummaryRow): RollingSummaryRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    coveredUntilMessageId: row.covered_until_message_id,
    content: row.content,
    model: row.model,
    createdAt: row.created_at,
  };
}

export function getLatestRollingSummary(
  db: DatabaseConnection,
  sessionId: string,
): RollingSummaryRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, covered_until_message_id, content, model, created_at
       FROM rolling_summaries WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId) as SummaryRow | undefined;
  return row ? mapRow(row) : null;
}

export interface InsertRollingSummaryInput {
  id: string;
  sessionId: string;
  coveredUntilMessageId: string | null;
  content: string;
  model: string;
  createdAt: string;
}

export function insertRollingSummary(
  db: DatabaseConnection,
  input: InsertRollingSummaryInput,
): void {
  db.prepare(
    `INSERT INTO rolling_summaries
       (id, session_id, covered_until_message_id, content, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.coveredUntilMessageId,
    input.content,
    input.model,
    input.createdAt,
  );
}

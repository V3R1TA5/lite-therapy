import type { RiskLevel } from '../../core/safety/types.js';
import type { DatabaseConnection } from '../database.js';

export interface RiskEventInput {
  id: string;
  sessionId: string;
  messageId: string | null;
  level: RiskLevel;
  detector: string;
  contextJson?: string;
  createdAt: string;
}

export interface RiskEventRecord {
  id: string;
  sessionId: string;
  messageId: string | null;
  level: RiskLevel;
  detector: string;
  contextJson: string;
  createdAt: string;
}

interface RiskEventRow {
  id: string;
  session_id: string;
  message_id: string | null;
  level: string;
  detector: string;
  context_json: string;
  created_at: string;
}

function mapRow(row: RiskEventRow): RiskEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    level: row.level as RiskLevel,
    detector: row.detector,
    contextJson: row.context_json,
    createdAt: row.created_at,
  };
}

export function recordRiskEvent(db: DatabaseConnection, input: RiskEventInput): void {
  db.prepare(
    `INSERT INTO risk_events
       (id, session_id, message_id, level, detector, context_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.messageId,
    input.level,
    input.detector,
    input.contextJson ?? '{}',
    input.createdAt,
  );
}

export function listRiskEvents(
  db: DatabaseConnection,
  sessionId: string,
  limit = 50,
): RiskEventRecord[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, message_id, level, detector, context_json, created_at
       FROM risk_events WHERE session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?`,
    )
    .all(sessionId, limit) as RiskEventRow[];
  return rows.map(mapRow);
}

export function countRiskEvents(db: DatabaseConnection, sessionId: string): number {
  const row = db
    .prepare('SELECT count(*) AS n FROM risk_events WHERE session_id = ?')
    .get(sessionId) as { n: number };
  return row.n;
}

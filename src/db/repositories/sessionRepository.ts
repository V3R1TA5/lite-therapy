import type { DatabaseConnection } from '../database.js';

export type SessionStatus = 'draft' | 'active' | 'ended';

export interface SessionRecord {
  id: string;
  title: string;
  status: SessionStatus;
  counselorId: string;
  startedAt: string;
  resumedAt: string;
  endedAt: string | null;
  riskState: string;
  memoryRecallEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  title: string;
  status: string;
  counselor_id: string;
  started_at: string;
  resumed_at: string;
  ended_at: string | null;
  risk_state: string;
  memory_recall_enabled: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, title, status, counselor_id, started_at, resumed_at, ended_at, risk_state, memory_recall_enabled, created_at, updated_at';

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status as SessionStatus,
    counselorId: row.counselor_id,
    startedAt: row.started_at,
    resumedAt: row.resumed_at,
    endedAt: row.ended_at,
    riskState: row.risk_state,
    memoryRecallEnabled: row.memory_recall_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface InsertSessionInput {
  id: string;
  title: string;
  status: SessionStatus;
  startedAt: string;
  resumedAt: string;
  createdAt: string;
  updatedAt: string;
  counselorId?: string;
  promptSnapshotJson?: string;
  memorySnapshotJson?: string;
  memoryRecallEnabled?: boolean;
}

export function insertSession(db: DatabaseConnection, input: InsertSessionInput): SessionRecord {
  db.prepare(
    `INSERT INTO sessions
       (id, title, status, counselor_id, started_at, resumed_at, ended_at, prompt_snapshot_json, memory_snapshot_json, risk_state, memory_recall_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'none', ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.status,
    input.counselorId ?? 'zhiwei',
    input.startedAt,
    input.resumedAt,
    input.promptSnapshotJson ?? null,
    input.memorySnapshotJson ?? null,
    input.memoryRecallEnabled === false ? 0 : 1,
    input.createdAt,
    input.updatedAt,
  );
  const session = getSession(db, input.id);
  if (session === null) {
    throw new Error('会谈写入后无法读回。');
  }
  return session;
}

export function getPromptSnapshotJson(db: DatabaseConnection, id: string): string | null {
  const row = db.prepare('SELECT prompt_snapshot_json FROM sessions WHERE id = ?').get(id) as
    | { prompt_snapshot_json: string | null }
    | undefined;
  return row?.prompt_snapshot_json ?? null;
}

export function setPromptSnapshot(
  db: DatabaseConnection,
  id: string,
  promptSnapshotJson: string,
  updatedAt: string,
): void {
  db.prepare('UPDATE sessions SET prompt_snapshot_json = ?, updated_at = ? WHERE id = ?').run(
    promptSnapshotJson,
    updatedAt,
    id,
  );
}

export function getMemorySnapshotJson(db: DatabaseConnection, id: string): string | null {
  const row = db.prepare('SELECT memory_snapshot_json FROM sessions WHERE id = ?').get(id) as
    | { memory_snapshot_json: string | null }
    | undefined;
  return row?.memory_snapshot_json ?? null;
}

export function getSession(db: DatabaseConnection, id: string): SessionRecord | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`).get(id) as
    | SessionRow
    | undefined;
  return row ? mapSession(row) : null;
}

export function getOpenSession(db: DatabaseConnection): SessionRecord | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM sessions WHERE status IN ('draft', 'active') ORDER BY updated_at DESC LIMIT 1`,
    )
    .get() as SessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function getLastEndedSession(db: DatabaseConnection): SessionRecord | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM sessions WHERE status = 'ended' ORDER BY ended_at DESC, updated_at DESC LIMIT 1`,
    )
    .get() as SessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function listSessions(db: DatabaseConnection, limit = 50): SessionRecord[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT ?`)
    .all(limit) as SessionRow[];
  return rows.map(mapSession);
}

export function setSessionStatus(
  db: DatabaseConnection,
  id: string,
  status: SessionStatus,
  updatedAt: string,
  options: { resumedAt?: string; endedAt?: string | null } = {},
): void {
  const current = getSession(db, id);
  if (current === null) {
    return;
  }
  const resumedAt = options.resumedAt ?? (status === 'active' ? updatedAt : current.resumedAt);
  const endedAt = options.endedAt === undefined ? current.endedAt : options.endedAt;
  db.prepare(
    'UPDATE sessions SET status = ?, resumed_at = ?, ended_at = ?, updated_at = ? WHERE id = ?',
  ).run(status, resumedAt, endedAt, updatedAt, id);
}

export function updateSessionTitle(
  db: DatabaseConnection,
  id: string,
  title: string,
  updatedAt: string,
): void {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(
    title,
    updatedAt,
    id,
  );
}

export function touchSession(db: DatabaseConnection, id: string, updatedAt: string): void {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(updatedAt, id);
}

export function setSessionRiskState(
  db: DatabaseConnection,
  id: string,
  riskState: string,
  updatedAt: string,
): void {
  db.prepare('UPDATE sessions SET risk_state = ?, updated_at = ? WHERE id = ?').run(
    riskState,
    updatedAt,
    id,
  );
}

export function deleteSession(db: DatabaseConnection, id: string): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function countSessions(db: DatabaseConnection): number {
  const row = db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number };
  return row.n;
}

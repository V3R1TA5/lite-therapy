import type { DatabaseConnection } from '../database.js';

export const POST_SESSION_JOB_KINDS = [
  'session_note',
  'case_formulation',
  'supervision',
  'memo',
  'letter',
  'memory',
] as const;

export type PostSessionJobKind = (typeof POST_SESSION_JOB_KINDS)[number];
export type PostSessionJobStatus = 'queued' | 'running' | 'ready' | 'failed' | 'stale' | 'skipped';

export interface PostSessionJobRecord {
  id: string;
  sessionId: string;
  kind: PostSessionJobKind;
  status: PostSessionJobStatus;
  attempts: number;
  model: string;
  error: string | null;
  sourceEndedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface JobRow {
  id: string;
  session_id: string;
  kind: PostSessionJobKind;
  status: PostSessionJobStatus;
  attempts: number;
  model: string;
  error: string | null;
  source_ended_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function mapJob(row: JobRow): PostSessionJobRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    model: row.model,
    error: row.error,
    sourceEndedAt: row.source_ended_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export function enqueuePostSessionJobs(
  db: DatabaseConnection,
  input: {
    sessionId: string;
    sourceEndedAt: string;
    model: string;
    kinds: readonly PostSessionJobKind[];
    now: string;
    newId: () => string;
  },
): PostSessionJobRecord[] {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO post_session_jobs
       (id, session_id, kind, status, attempts, model, error, source_ended_at,
        started_at, finished_at, created_at)
     VALUES (?, ?, ?, 'queued', 0, ?, NULL, ?, NULL, NULL, ?)`,
  );
  const transaction = db.transaction(() => {
    for (const kind of input.kinds) {
      insert.run(input.newId(), input.sessionId, kind, input.model, input.sourceEndedAt, input.now);
    }
  });
  transaction();
  return listPostSessionJobs(db, input.sessionId);
}

export function listPostSessionJobs(
  db: DatabaseConnection,
  sessionId: string,
): PostSessionJobRecord[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, kind, status, attempts, model, error, source_ended_at,
              started_at, finished_at, created_at
       FROM post_session_jobs WHERE session_id = ?
       ORDER BY created_at, rowid`,
    )
    .all(sessionId) as JobRow[];
  return rows.map(mapJob);
}

export function getPostSessionJob(
  db: DatabaseConnection,
  jobId: string,
): PostSessionJobRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, kind, status, attempts, model, error, source_ended_at,
              started_at, finished_at, created_at
       FROM post_session_jobs WHERE id = ?`,
    )
    .get(jobId) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function setJobRunning(db: DatabaseConnection, jobId: string, startedAt: string): void {
  db.prepare(
    `UPDATE post_session_jobs
     SET status = 'running', attempts = attempts + 1, started_at = ?, finished_at = NULL,
         error = NULL
     WHERE id = ?`,
  ).run(startedAt, jobId);
}

export function setJobReady(db: DatabaseConnection, jobId: string, finishedAt: string): void {
  db.prepare(
    `UPDATE post_session_jobs SET status = 'ready', finished_at = ?, error = NULL
     WHERE id = ?`,
  ).run(finishedAt, jobId);
}

export function setJobFailed(
  db: DatabaseConnection,
  jobId: string,
  error: string,
  finishedAt: string,
): void {
  db.prepare(
    `UPDATE post_session_jobs SET status = 'failed', finished_at = ?, error = ?
     WHERE id = ?`,
  ).run(finishedAt, error.slice(0, 300), jobId);
}

export function setJobQueued(db: DatabaseConnection, jobId: string, error?: string): void {
  db.prepare(
    `UPDATE post_session_jobs SET status = 'queued', error = ?, started_at = NULL,
       finished_at = NULL WHERE id = ?`,
  ).run(error === undefined ? null : error.slice(0, 300), jobId);
}

export function setJobSkipped(
  db: DatabaseConnection,
  jobId: string,
  reason: string,
  finishedAt: string,
): void {
  db.prepare(
    `UPDATE post_session_jobs SET status = 'skipped', finished_at = ?, error = ?
     WHERE id = ?`,
  ).run(finishedAt, reason.slice(0, 300), jobId);
}

export function archiveReadyMemosForSession(db: DatabaseConnection, sessionId: string): void {
  db.prepare("UPDATE memos SET status = 'archived' WHERE session_id = ? AND status = 'ready'").run(
    sessionId,
  );
}

export function listSessionsWithQueuedJobs(db: DatabaseConnection): Array<{ sessionId: string }> {
  return db
    .prepare(
      "SELECT DISTINCT session_id AS sessionId FROM post_session_jobs WHERE status = 'queued' ORDER BY session_id",
    )
    .all() as Array<{ sessionId: string }>;
}

export function resetRunningPostSessionJobs(db: DatabaseConnection): void {
  db.prepare(
    "UPDATE post_session_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'",
  ).run();
}

export function markSessionJobsStale(db: DatabaseConnection, sessionId: string): void {
  db.prepare(
    `UPDATE post_session_jobs SET status = 'stale', finished_at = ?
     WHERE session_id = ? AND status IN ('queued', 'running', 'failed', 'ready')`,
  ).run(new Date().toISOString(), sessionId);
}

export interface SessionNoteRecord {
  id: string;
  sessionId: string;
  content: string;
  model: string;
  sourceEndedAt: string;
  createdAt: string;
}

interface SessionNoteRow {
  id: string;
  session_id: string;
  content: string;
  model: string;
  source_ended_at: string;
  created_at: string;
}

function mapNote(row: SessionNoteRow): SessionNoteRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    model: row.model,
    sourceEndedAt: row.source_ended_at,
    createdAt: row.created_at,
  };
}

export function insertSessionNote(
  db: DatabaseConnection,
  input: Omit<SessionNoteRecord, 'createdAt'> & { createdAt: string },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO session_notes
       (id, session_id, content, model, source_ended_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.content,
    input.model,
    input.sourceEndedAt,
    input.createdAt,
  );
}

export function getLatestSessionNote(
  db: DatabaseConnection,
  sessionId: string,
): SessionNoteRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, content, model, source_ended_at, created_at
       FROM session_notes WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId) as SessionNoteRow | undefined;
  return row ? mapNote(row) : null;
}

export function listRecentSessionNotes(db: DatabaseConnection, limit = 3): SessionNoteRecord[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, content, model, source_ended_at, created_at
       FROM session_notes ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(limit) as SessionNoteRow[];
  return rows.map(mapNote);
}

export interface CaseFormulationRecord {
  id: string;
  counselorId: string;
  version: number;
  content: string;
  coveredSessionIds: string[];
  model: string;
  createdAt: string;
}

interface CaseFormulationRow {
  id: string;
  counselor_id: string;
  version: number;
  content: string;
  covered_session_ids_json: string;
  model: string;
  created_at: string;
}

function mapFormulation(row: CaseFormulationRow): CaseFormulationRecord {
  return {
    id: row.id,
    counselorId: row.counselor_id,
    version: row.version,
    content: row.content,
    coveredSessionIds: JSON.parse(row.covered_session_ids_json) as string[],
    model: row.model,
    createdAt: row.created_at,
  };
}

export function getLatestCaseFormulation(
  db: DatabaseConnection,
  counselorId: string,
): CaseFormulationRecord | null {
  const row = db
    .prepare(
      `SELECT id, counselor_id, version, content, covered_session_ids_json, model, created_at
       FROM case_formulations WHERE counselor_id = ?
       ORDER BY version DESC, created_at DESC LIMIT 1`,
    )
    .get(counselorId) as CaseFormulationRow | undefined;
  return row ? mapFormulation(row) : null;
}

export function insertCaseFormulation(
  db: DatabaseConnection,
  input: {
    id: string;
    counselorId: string;
    version: number;
    content: string;
    coveredSessionIds: string[];
    model: string;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO case_formulations
       (id, counselor_id, version, content, covered_session_ids_json, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.counselorId,
    input.version,
    input.content,
    JSON.stringify(input.coveredSessionIds),
    input.model,
    input.createdAt,
  );
}

export interface SupervisionRecord {
  id: string;
  sessionId: string;
  content: string;
  model: string;
  sourceEndedAt: string;
  createdAt: string;
}

interface SupervisionRow {
  id: string;
  session_id: string;
  content: string;
  model: string;
  source_ended_at: string;
  created_at: string;
}

function mapSupervision(row: SupervisionRow): SupervisionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    model: row.model,
    sourceEndedAt: row.source_ended_at,
    createdAt: row.created_at,
  };
}

export function insertSupervision(
  db: DatabaseConnection,
  input: Omit<SupervisionRecord, 'createdAt'> & { createdAt: string },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO supervisions
       (id, session_id, content, model, source_ended_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.content,
    input.model,
    input.sourceEndedAt,
    input.createdAt,
  );
}

export function getLatestSupervision(
  db: DatabaseConnection,
  sessionId: string,
): SupervisionRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, content, model, source_ended_at, created_at
       FROM supervisions WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId) as SupervisionRow | undefined;
  return row ? mapSupervision(row) : null;
}

export type MemoStatus = 'ready' | 'invalid' | 'archived';

export interface MemoRecord {
  id: string;
  sessionId: string;
  counselorId: string;
  content: string;
  status: MemoStatus;
  model: string;
  sourceEndedAt: string;
  createdAt: string;
}

interface MemoRow {
  id: string;
  session_id: string;
  counselor_id: string;
  content: string;
  status: MemoStatus;
  model: string;
  source_ended_at: string;
  created_at: string;
}

function mapMemo(row: MemoRow): MemoRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    counselorId: row.counselor_id,
    content: row.content,
    status: row.status,
    model: row.model,
    sourceEndedAt: row.source_ended_at,
    createdAt: row.created_at,
  };
}

export function insertMemo(
  db: DatabaseConnection,
  input: Omit<MemoRecord, 'createdAt'> & { createdAt: string },
): void {
  const transaction = db.transaction(() => {
    if (input.status !== 'ready') {
      db.prepare(
        `UPDATE memos SET status = 'archived'
         WHERE session_id = ? AND source_ended_at = ? AND status = 'ready'`,
      ).run(input.sessionId, input.sourceEndedAt);
    }
    db.prepare(
      `INSERT INTO memos
         (id, session_id, counselor_id, content, status, model, source_ended_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.sessionId,
      input.counselorId,
      input.content,
      input.status,
      input.model,
      input.sourceEndedAt,
      input.createdAt,
    );
  });
  transaction();
}

export function getLatestReadyMemo(db: DatabaseConnection, counselorId: string): MemoRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, counselor_id, content, status, model, source_ended_at, created_at
       FROM memos WHERE counselor_id = ? AND status = 'ready'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(counselorId) as MemoRow | undefined;
  return row ? mapMemo(row) : null;
}

export function getReadyMemoById(db: DatabaseConnection, memoId: string): MemoRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, counselor_id, content, status, model, source_ended_at, created_at
       FROM memos WHERE id = ? AND status = 'ready' LIMIT 1`,
    )
    .get(memoId) as MemoRow | undefined;
  return row ? mapMemo(row) : null;
}

export function getReadyMemoForSession(
  db: DatabaseConnection,
  sessionId: string,
): MemoRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, counselor_id, content, status, model, source_ended_at, created_at
       FROM memos WHERE session_id = ? AND status = 'ready'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId) as MemoRow | undefined;
  return row ? mapMemo(row) : null;
}

export interface LetterRecord {
  id: string;
  sessionId: string;
  content: string;
  model: string;
  sourceEndedAt: string;
  readAt: string | null;
  createdAt: string;
}

interface LetterRow {
  id: string;
  session_id: string;
  content: string;
  model: string;
  source_ended_at: string;
  read_at: string | null;
  created_at: string;
}

function mapLetter(row: LetterRow): LetterRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    model: row.model,
    sourceEndedAt: row.source_ended_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function insertLetter(
  db: DatabaseConnection,
  input: Omit<LetterRecord, 'createdAt' | 'readAt'> & { createdAt: string },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO letters
       (id, session_id, content, model, source_ended_at, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.content,
    input.model,
    input.sourceEndedAt,
    input.createdAt,
  );
}

export function getLatestLetterForSession(
  db: DatabaseConnection,
  sessionId: string,
): LetterRecord | null {
  const row = db
    .prepare(
      `SELECT id, session_id, content, model, source_ended_at, read_at, created_at
       FROM letters WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId) as LetterRow | undefined;
  return row ? mapLetter(row) : null;
}

export function listLetters(db: DatabaseConnection, limit = 50): LetterRecord[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, content, model, source_ended_at, read_at, created_at
       FROM letters ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(limit) as LetterRow[];
  return rows.map(mapLetter);
}

export function countUnreadLetters(db: DatabaseConnection): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM letters WHERE read_at IS NULL').get() as {
    count: number;
  };
  return row.count;
}

export function markLetterRead(db: DatabaseConnection, letterId: string, readAt: string): void {
  db.prepare('UPDATE letters SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(
    readAt,
    letterId,
  );
}

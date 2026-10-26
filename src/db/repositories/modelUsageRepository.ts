import type { DatabaseConnection } from '../database.js';

export interface ModelUsageInput {
  id: string;
  sessionId: string | null;
  task: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  costEstimate?: number;
  createdAt: string;
}

export interface ModelUsageRecord extends ModelUsageInput {
  sessionId: string | null;
}

export function recordModelUsage(db: DatabaseConnection, input: ModelUsageInput): void {
  db.prepare(
    `INSERT INTO model_usage
       (id, session_id, task, model, prompt_tokens, completion_tokens, cost_estimate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.task,
    input.model,
    input.promptTokens ?? null,
    input.completionTokens ?? null,
    input.costEstimate ?? null,
    input.createdAt,
  );
}

export function sumUsageForSession(
  db: DatabaseConnection,
  sessionId: string,
): { promptTokens: number; completionTokens: number } {
  const row = db
    .prepare(
      `SELECT
         coalesce(sum(prompt_tokens), 0) AS prompt_tokens,
         coalesce(sum(completion_tokens), 0) AS completion_tokens
       FROM model_usage WHERE session_id = ?`,
    )
    .get(sessionId) as { prompt_tokens: number; completion_tokens: number };
  return { promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens };
}

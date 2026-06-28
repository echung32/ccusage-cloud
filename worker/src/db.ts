import type { SessionPayload, DailyPayload } from './schema';

const UPSERT = `
INSERT INTO sessions (
  user_id, device_id, source, session_id,
  input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
  total_tokens, total_cost, credits, first_activity, last_activity,
  models_used, model_breakdowns, project_path, updated_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT (user_id, device_id, source, session_id, project_path) DO UPDATE SET
  input_tokens          = excluded.input_tokens,
  output_tokens         = excluded.output_tokens,
  cache_creation_tokens = excluded.cache_creation_tokens,
  cache_read_tokens     = excluded.cache_read_tokens,
  total_tokens          = excluded.total_tokens,
  total_cost            = excluded.total_cost,
  credits               = excluded.credits,
  first_activity        = excluded.first_activity,
  last_activity         = excluded.last_activity,
  models_used           = excluded.models_used,
  model_breakdowns      = excluded.model_breakdowns,
  updated_at            = excluded.updated_at
`;

export async function upsertSessions(
  db: D1Database,
  userId: string,
  deviceId: string,
  sessions: SessionPayload[],
): Promise<number> {
  if (sessions.length === 0) return 0;
  const now = Date.now();
  const stmt = db.prepare(UPSERT);
  const batch = sessions.map((s) =>
    stmt.bind(
      userId,
      deviceId,
      s.source,
      s.sessionId,
      s.inputTokens,
      s.outputTokens,
      s.cacheCreationTokens,
      s.cacheReadTokens,
      s.totalTokens,
      s.totalCost,
      s.credits ?? null,
      s.firstActivity ?? null,
      s.lastActivity ?? null,
      JSON.stringify(s.modelsUsed),
      JSON.stringify(s.modelBreakdowns ?? null),
      s.projectPath ?? '',
      now,
    ),
  );
  await db.batch(batch);
  return sessions.length;
}

const UPSERT_DAILY = `
INSERT INTO usage_daily (user_id, device_id, source, day, total_tokens, total_cost, updated_at)
VALUES (?,?,?,?,?,?,?)
ON CONFLICT (user_id, device_id, source, day) DO UPDATE SET
  total_tokens = excluded.total_tokens,
  total_cost   = excluded.total_cost,
  updated_at   = excluded.updated_at
`;

export async function upsertDaily(
  db: D1Database,
  userId: string,
  deviceId: string,
  rows: DailyPayload[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = Date.now();
  const stmt = db.prepare(UPSERT_DAILY);
  const batch = rows.map((r) =>
    stmt.bind(userId, deviceId, r.source, r.day, r.totalTokens, r.totalCost, now),
  );
  await db.batch(batch);
  return rows.length;
}

export interface SummaryFilters {
  from?: string;
  to?: string;
  source?: string;
  device?: string;
}

export interface SummaryTotals {
  sessions: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
}

export interface ByDay { day: string; totalTokens: number; totalCost: number }
export interface BySource { source: string; totalTokens: number; totalCost: number; sessions: number }
export interface ByModel { model: string; totalTokens: number; totalCost: number }
export interface ByProject { projectPath: string; totalTokens: number; totalCost: number; sessions: number }
export interface ByDevice { deviceId: string; label: string; totalTokens: number; totalCost: number; sessions: number }

export interface Summary {
  totals: SummaryTotals;
  byDay: ByDay[];
  bySource: BySource[];
  byModel: ByModel[];
  byProject: ByProject[];
  byDevice: ByDevice[];
}

interface WhereClause { sql: string; binds: (string)[] }

function buildWhere(userId: string, f: SummaryFilters): WhereClause {
  const parts = ['s.user_id = ?'];
  const binds: string[] = [userId];
  if (f.from) { parts.push('s.last_activity >= ?'); binds.push(f.from); }
  if (f.to) { parts.push('s.last_activity <= ?'); binds.push(f.to); }
  if (f.source) { parts.push('s.source = ?'); binds.push(f.source); }
  if (f.device) { parts.push('s.device_id = ?'); binds.push(f.device); }
  return { sql: parts.join(' AND '), binds };
}

async function runTotals(db: D1Database, w: WhereClause): Promise<SummaryTotals> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(s.total_tokens),0) AS totalTokens,
              COALESCE(SUM(s.input_tokens),0) AS inputTokens,
              COALESCE(SUM(s.output_tokens),0) AS outputTokens,
              COALESCE(SUM(s.cache_creation_tokens),0) AS cacheCreationTokens,
              COALESCE(SUM(s.cache_read_tokens),0) AS cacheReadTokens,
              COALESCE(SUM(s.total_cost),0) AS totalCost
       FROM sessions s WHERE ${w.sql}`,
    )
    .bind(...w.binds)
    .first<SummaryTotals>();
  return row ?? { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 };
}

async function runByDay(db: D1Database, w: WhereClause): Promise<ByDay[]> {
  return (await db.prepare(
    `SELECT substr(s.last_activity,1,10) AS day,
            COALESCE(SUM(s.total_tokens),0) AS totalTokens,
            COALESCE(SUM(s.total_cost),0) AS totalCost
     FROM sessions s WHERE ${w.sql} AND s.last_activity IS NOT NULL
     GROUP BY day ORDER BY day`,
  ).bind(...w.binds).all<ByDay>()).results;
}

async function runBySource(db: D1Database, w: WhereClause): Promise<BySource[]> {
  return (await db.prepare(
    `SELECT s.source AS source,
            COALESCE(SUM(s.total_tokens),0) AS totalTokens,
            COALESCE(SUM(s.total_cost),0) AS totalCost,
            COUNT(*) AS sessions
     FROM sessions s WHERE ${w.sql}
     GROUP BY s.source ORDER BY totalCost DESC`,
  ).bind(...w.binds).all<BySource>()).results;
}

// byModel: json_each over model_breakdowns; keys verified per Task A2.
async function runByModel(db: D1Database, w: WhereClause): Promise<ByModel[]> {
  return (await db.prepare(
    `SELECT json_extract(je.value, '$.modelName') AS model,
            COALESCE(SUM(
              COALESCE(json_extract(je.value, '$.inputTokens'),0) +
              COALESCE(json_extract(je.value, '$.outputTokens'),0) +
              COALESCE(json_extract(je.value, '$.cacheCreationTokens'),0) +
              COALESCE(json_extract(je.value, '$.cacheReadTokens'),0)
            ),0) AS totalTokens,
            COALESCE(SUM(COALESCE(json_extract(je.value, '$.cost'),0)),0) AS totalCost
     FROM sessions s, json_each(s.model_breakdowns) je
     WHERE ${w.sql}
       AND s.model_breakdowns IS NOT NULL
       AND json_valid(s.model_breakdowns)
       AND json_extract(je.value, '$.modelName') IS NOT NULL
     GROUP BY model ORDER BY totalCost DESC`,
  ).bind(...w.binds).all<ByModel>()).results;
}

export async function summaryQuery(db: D1Database, userId: string, filters: SummaryFilters): Promise<Summary> {
  const w = buildWhere(userId, filters);

  const [totals, byDay, bySource, byModel] = await Promise.all([
    runTotals(db, w),
    runByDay(db, w),
    runBySource(db, w),
    runByModel(db, w),
  ]);

  const byProject = (
    await db
      .prepare(
        `SELECT COALESCE(s.project_path, '(unknown)') AS projectPath,
                COALESCE(SUM(s.total_tokens),0) AS totalTokens,
                COALESCE(SUM(s.total_cost),0) AS totalCost,
                COUNT(*) AS sessions
         FROM sessions s WHERE ${w.sql}
         GROUP BY projectPath ORDER BY totalCost DESC`,
      )
      .bind(...w.binds)
      .all<ByProject>()
  ).results;

  const byDevice = (
    await db
      .prepare(
        `SELECT s.device_id AS deviceId,
                COALESCE(d.label, s.device_id) AS label,
                COALESCE(SUM(s.total_tokens),0) AS totalTokens,
                COALESCE(SUM(s.total_cost),0) AS totalCost,
                COUNT(*) AS sessions
         FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
         WHERE ${w.sql}
         GROUP BY s.device_id, label ORDER BY totalCost DESC`,
      )
      .bind(...w.binds)
      .all<ByDevice>()
  ).results;

  return { totals, byDay, bySource, byModel, byProject, byDevice };
}

function buildGroupWhere(f: SummaryFilters): WhereClause {
  const parts = ['s.user_id IN (SELECT id FROM users WHERE public_to_group = 1)'];
  const binds: string[] = [];
  if (f.from) { parts.push('s.last_activity >= ?'); binds.push(f.from); }
  if (f.to) { parts.push('s.last_activity <= ?'); binds.push(f.to); }
  if (f.source) { parts.push('s.source = ?'); binds.push(f.source); }
  // device filter is intentionally ignored in group scope (device ids are per-user).
  return { sql: parts.join(' AND '), binds };
}

export async function groupSummaryQuery(db: D1Database, filters: SummaryFilters): Promise<Summary> {
  const w = buildGroupWhere(filters);
  const [totals, byDay, bySource, byModel] = await Promise.all([
    runTotals(db, w), runByDay(db, w), runBySource(db, w), runByModel(db, w),
  ]);
  // per-person contribution (overall-only; reuses the ByDevice shape, label = email)
  const byPerson = (await db.prepare(
    `SELECT u.id AS deviceId, u.email AS label,
            COALESCE(SUM(s.total_tokens),0) AS totalTokens,
            COALESCE(SUM(s.total_cost),0) AS totalCost,
            COUNT(*) AS sessions
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE u.public_to_group = 1${filters.from ? ' AND s.last_activity >= ?' : ''}${filters.to ? ' AND s.last_activity <= ?' : ''}${filters.source ? ' AND s.source = ?' : ''}
     GROUP BY u.id, u.email ORDER BY totalCost DESC`,
  ).bind(...[filters.from, filters.to, filters.source].filter((x): x is string => !!x)).all<ByDevice>()).results;
  return { totals, byDay, bySource, byModel, byProject: [], byDevice: byPerson };
}

export interface SessionRow {
  source: string;
  sessionId: string;
  deviceId: string;
  totalTokens: number;
  totalCost: number;
  firstActivity: string | null;
  lastActivity: string | null;
  modelsUsed: string[];
  projectPath: string | null;
}

export interface SessionsPage {
  sessions: SessionRow[];
  nextCursor: string | null;
}

export function encodeCursor(row: { lastActivity: string | null; source: string; sessionId: string }): string {
  const payload = JSON.stringify([row.lastActivity ?? '', row.source, row.sessionId]);
  return btoa(payload);
}

export function decodeCursor(cursor: string): { lastActivity: string; source: string; sessionId: string } | null {
  try {
    const arr = JSON.parse(atob(cursor)) as unknown;
    if (!Array.isArray(arr) || arr.length !== 3) return null;
    const [lastActivity, source, sessionId] = arr;
    if (typeof lastActivity !== 'string' || typeof source !== 'string' || typeof sessionId !== 'string') return null;
    return { lastActivity, source, sessionId };
  } catch {
    return null;
  }
}

export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(raw)));
}

interface RawSessionRow {
  source: string;
  session_id: string;
  device_id: string;
  total_tokens: number;
  total_cost: number;
  first_activity: string | null;
  last_activity: string | null;
  models_used: string | null;
  project_path: string | null;
}

function parseModels(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function sessionsPage(
  db: D1Database,
  userId: string,
  filters: SummaryFilters,
  cursor: string | null,
  limit: number,
): Promise<SessionsPage> {
  const w = buildWhere(userId, filters);
  const parts = [w.sql];
  const binds = [...w.binds];
  if (cursor) {
    const c = decodeCursor(cursor);
    if (c) {
      // (last_activity, source, session_id) strictly less than the cursor (descending).
      parts.push(
        '(s.last_activity < ? OR (s.last_activity = ? AND s.source < ?) OR (s.last_activity = ? AND s.source = ? AND s.session_id < ?))',
      );
      binds.push(c.lastActivity, c.lastActivity, c.source, c.lastActivity, c.source, c.sessionId);
    }
  }
  const rows = (
    await db
      .prepare(
        `SELECT s.source, s.session_id, s.device_id, s.total_tokens, s.total_cost,
                s.first_activity, s.last_activity, s.models_used, s.project_path
         FROM sessions s
         WHERE ${parts.join(' AND ')}
         ORDER BY s.last_activity DESC, s.source DESC, s.session_id DESC
         LIMIT ?`,
      )
      .bind(...binds, limit + 1)
      .all<RawSessionRow>()
  ).results;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const sessions: SessionRow[] = page.map((r) => ({
    source: r.source,
    sessionId: r.session_id,
    deviceId: r.device_id,
    totalTokens: r.total_tokens,
    totalCost: r.total_cost,
    firstActivity: r.first_activity,
    lastActivity: r.last_activity,
    modelsUsed: parseModels(r.models_used),
    projectPath: r.project_path,
  }));
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ lastActivity: last.last_activity, source: last.source, sessionId: last.session_id }) : null;
  return { sessions, nextCursor };
}

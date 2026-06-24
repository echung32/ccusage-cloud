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

export async function summaryQuery(db: D1Database, userId: string, filters: SummaryFilters): Promise<Summary> {
  const w = buildWhere(userId, filters);

  const totalsRow = await db
    .prepare(
      `SELECT
         COUNT(*) AS sessions,
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

  const byDay = (
    await db
      .prepare(
        `SELECT substr(s.last_activity,1,10) AS day,
                COALESCE(SUM(s.total_tokens),0) AS totalTokens,
                COALESCE(SUM(s.total_cost),0) AS totalCost
         FROM sessions s WHERE ${w.sql} AND s.last_activity IS NOT NULL
         GROUP BY day ORDER BY day`,
      )
      .bind(...w.binds)
      .all<ByDay>()
  ).results;

  const bySource = (
    await db
      .prepare(
        `SELECT s.source AS source,
                COALESCE(SUM(s.total_tokens),0) AS totalTokens,
                COALESCE(SUM(s.total_cost),0) AS totalCost,
                COUNT(*) AS sessions
         FROM sessions s WHERE ${w.sql}
         GROUP BY s.source ORDER BY totalCost DESC`,
      )
      .bind(...w.binds)
      .all<BySource>()
  ).results;

  // byModel: json_each over model_breakdowns; keys verified per Task A2.
  const byModel = (
    await db
      .prepare(
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
      )
      .bind(...w.binds)
      .all<ByModel>()
  ).results;

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

  return {
    totals: totalsRow ?? {
      sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0,
    },
    byDay,
    bySource,
    byModel,
    byProject,
    byDevice,
  };
}

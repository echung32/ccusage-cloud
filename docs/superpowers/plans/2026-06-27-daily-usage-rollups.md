# Daily Usage Rollups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back the dashboard "tokens/cost over time" charts with per-day rollups from `ccusage <source> daily --json` so sources whose `session` output lacks dates (opencode, etc.) appear on the timeline.

**Architecture:** A new `usage_daily` D1 table holds per-`(user, device, source, day)` token+cost totals, ingested via a new public-shape `/ingest/daily` endpoint (device-token auth). The `byDay`/`byDaySource` summary queries (personal + group scope) read from `usage_daily`; every other view stays on the `sessions` table. The CLI's `sync` command pushes daily rollups after the existing session push.

**Tech Stack:** Cloudflare Workers (Hono), D1 (SQLite), KV; Node ≥20 CLI (tsup, valibot, vitest); dashboard unchanged.

## Global Constraints

- Rollup grain is **per source/day, total tokens + total cost only** — no model dimension, no input/output/cache breakdown in `usage_daily` (those stay in `sessions`).
- `usage_daily` PK is `(user_id, device_id, source, day)`; `day` is `'YYYY-MM-DD'`.
- All daily rows are **re-sent every sync** and upserted (no incremental hashing) — the current day's bucket grows over time.
- Daily cost field resolves as `totalCost ?? costUSD ?? 0` (codex daily uses `costUSD`); rows without a `date` are skipped.
- `/ingest/daily` uses device-token auth (`deviceAuth`) + the existing KV rate limiter; payload capped at 1000 rows.
- No dashboard component changes. No new runtime dependencies (hono, valibot, built-ins only).
- `sessions` table, session ingest, and `syncOnce` behavior/return shape are **unchanged**.

## File Structure

**Worker (`worker/`):**
- Create `migrations/0003_usage_daily.sql` — `usage_daily` table.
- Modify `src/schema.ts` — `DailyRowSchema`, `IngestDailySchema`, `DailyPayload`.
- Modify `src/db.ts` — `upsertDaily`.
- Modify `src/index.ts` — `POST /ingest/daily`.
- Modify `src/queries.ts` — `buildDailyWhere`, `buildGroupDailyWhere`; `runByDay`/`runByDaySource` read `usage_daily`; update both call sites.
- Create `test/usage-daily.test.ts`.

**CLI (`cli/`):**
- Modify `src/ccusage.ts` — export `defaultRunner`.
- Create `src/daily.ts` — `loadDaily`, `DailyRow`.
- Modify `src/sync.ts` — extract `postJson`; add `syncDaily`.
- Modify `src/index.ts` — call `syncDaily` in the `sync` command and report the count.
- Create `test/daily.test.ts`, `test/daily-sync.test.ts`.

---

## Task 1: D1 migration for `usage_daily`

**Files:**
- Create: `worker/migrations/0003_usage_daily.sql`
- Test: `worker/test/usage-daily.test.ts`

**Interfaces:**
- Produces: table `usage_daily(user_id TEXT, device_id TEXT, source TEXT, day TEXT, total_tokens INTEGER, total_cost REAL, updated_at INTEGER, PRIMARY KEY(user_id, device_id, source, day))` and index `idx_usage_daily_user_day`. The vitest workers pool auto-applies every file in `migrations/`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/usage-daily.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('usage_daily migration', () => {
  it('exposes a writable usage_daily table keyed by (user,device,source,day)', async () => {
    await env.DB.prepare(
      'INSERT INTO usage_daily (user_id, device_id, source, day, total_tokens, total_cost, updated_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind('usr_x', 'dev_x', 'claude', '2026-06-01', 100, 0.5, 1000)
      .run();
    const row = await env.DB.prepare(
      'SELECT total_tokens AS t, total_cost AS c FROM usage_daily WHERE user_id=? AND device_id=? AND source=? AND day=?',
    )
      .bind('usr_x', 'dev_x', 'claude', '2026-06-01')
      .first<{ t: number; c: number }>();
    expect(row?.t).toBe(100);
    expect(row?.c).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccusage-cloud/worker test usage-daily`
Expected: FAIL — `no such table: usage_daily`.

- [ ] **Step 3: Create the migration**

Create `worker/migrations/0003_usage_daily.sql`:

```sql
CREATE TABLE usage_daily (
  user_id      TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  source       TEXT NOT NULL,
  day          TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  total_cost   REAL NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, source, day)
);
CREATE INDEX idx_usage_daily_user_day ON usage_daily(user_id, day);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccusage-cloud/worker test usage-daily`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0003_usage_daily.sql worker/test/usage-daily.test.ts
git commit -m "feat(worker): add usage_daily rollup table"
```

---

## Task 2: Worker — `/ingest/daily` endpoint

**Files:**
- Modify: `worker/src/schema.ts`
- Modify: `worker/src/db.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/usage-daily.test.ts` (append)

**Interfaces:**
- Consumes: `deviceAuth`, `rateLimit`, the `usage_daily` table.
- Produces:
  - `schema.ts`: `DailyRowSchema = { source: string, day: string, totalTokens: number, totalCost: number }`; `IngestDailySchema = { days: DailyRowSchema[] (max 1000) }`; `type DailyPayload = InferOutput<DailyRowSchema>`.
  - `db.ts`: `upsertDaily(db: D1Database, userId: string, deviceId: string, rows: DailyPayload[]): Promise<number>`.
  - `index.ts`: `POST /ingest/daily` returning `{ upserted: number }` (400 invalid, 401 bad token, 429 rate-limited).

- [ ] **Step 1: Write the failing test**

Append to `worker/test/usage-daily.test.ts` (add the imports to the top of the file, merging with the existing `env` import):

```ts
import { SELF, env } from 'cloudflare:test';
import { seedDevice } from './seed';

async function asDevice(token: string, body: unknown) {
  return SELF.fetch('https://example.com/ingest/daily', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('POST /ingest/daily', () => {
  it('401s without a device token', async () => {
    const res = await SELF.fetch('https://example.com/ingest/daily', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('upserts rows and updates the same (source,day) in place', async () => {
    const { token, userId, deviceId } = await seedDevice(env);
    const first = await asDevice(token, { days: [{ source: 'opencode', day: '2025-08-29', totalTokens: 100, totalCost: 0.25 }] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ upserted: 1 });

    // re-send same (source,day) with new totals → update, not duplicate
    await asDevice(token, { days: [{ source: 'opencode', day: '2025-08-29', totalTokens: 175, totalCost: 0.4 }] });

    const rows = await env.DB.prepare(
      'SELECT total_tokens AS t, total_cost AS c FROM usage_daily WHERE user_id=? AND device_id=? AND source=? AND day=?',
    ).bind(userId, deviceId, 'opencode', '2025-08-29').all<{ t: number; c: number }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toEqual({ t: 175, c: 0.4 });
  });

  it('400s on an invalid payload', async () => {
    const { token } = await seedDevice(env);
    const res = await asDevice(token, { days: [{ source: 'x', day: '2025-01-01', totalTokens: 'nan', totalCost: 0 }] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccusage-cloud/worker test usage-daily`
Expected: FAIL — `/ingest/daily` returns 404 (route not defined) / `upsertDaily` missing.

- [ ] **Step 3: Add the schema**

In `worker/src/schema.ts`, append:

```ts
export const DailyRowSchema = v.object({
  source: v.string(),
  day: v.string(),
  totalTokens: v.number(),
  totalCost: v.number(),
});

export const IngestDailySchema = v.object({
  days: v.pipe(v.array(DailyRowSchema), v.maxLength(1000)),
});

export type DailyPayload = v.InferOutput<typeof DailyRowSchema>;
```

- [ ] **Step 4: Add `upsertDaily`**

In `worker/src/db.ts`, add the import and function (keep the existing `upsertSessions` untouched):

```ts
import type { SessionPayload, DailyPayload } from './schema';
```
(replace the existing `import type { SessionPayload } from './schema';` line with the line above)

Append at the end of the file:

```ts
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
```

- [ ] **Step 5: Add the route**

In `worker/src/index.ts`:

(a) Extend the existing imports:

```ts
import { IngestSchema, IngestDailySchema } from './schema';
import { upsertSessions, upsertDaily } from './db';
```
(these replace the existing `import { IngestSchema } from './schema';` and `import { upsertSessions } from './db';` lines)

(b) Add the route immediately after the existing `app.post('/ingest', ...)` handler:

```ts
app.post('/ingest/daily', deviceAuth, async (c) => {
  const rl = await rateLimit(c.env.RATE_LIMITS, `ingest-daily:${c.var.device.deviceId}`, 600, 60);
  if (!rl.ok) return c.json({ error: 'rate limited' }, 429);
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(IngestDailySchema, body);
  if (!parsed.success) {
    return c.json({ error: 'invalid payload' }, 400);
  }
  const { userId, deviceId } = c.var.device;
  const upserted = await upsertDaily(c.env.DB, userId, deviceId, parsed.output.days);
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?')
    .bind(Date.now(), deviceId)
    .run();
  return c.json({ upserted });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @ccusage-cloud/worker test usage-daily`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/src/schema.ts worker/src/db.ts worker/src/index.ts worker/test/usage-daily.test.ts
git commit -m "feat(worker): ingest daily usage rollups"
```

---

## Task 3: Worker — timeline queries read `usage_daily`

**Files:**
- Modify: `worker/src/queries.ts`
- Test: `worker/test/usage-daily.test.ts` (append)

**Interfaces:**
- Consumes: `usage_daily` table; existing `WhereClause`, `SummaryFilters`, `ByDay`, `ByDaySource` types.
- Produces: `buildDailyWhere(userId, f)` and `buildGroupDailyWhere(f)`; `runByDay`/`runByDaySource` now select from `usage_daily` and expect a daily `WhereClause`. `summaryQuery` and `groupSummaryQuery` call them with the daily where; all other sub-queries are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `worker/test/usage-daily.test.ts`:

```ts
import { seedSession } from './seed';
import { installJwks, mintToken } from './auth-fixture';
import { beforeAll } from 'vitest';

beforeAll(() => installJwks());

async function asViewer(userId: string, path: string) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, { headers: { authorization: `Bearer ${token}` } });
}

async function seedDaily(userId: string, deviceId: string, source: string, day: string, tokens: number, cost: number) {
  await env.DB.prepare(
    'INSERT INTO usage_daily (user_id, device_id, source, day, total_tokens, total_cost, updated_at) VALUES (?,?,?,?,?,?,?)',
  ).bind(userId, deviceId, source, day, tokens, cost, 1).run();
}

describe('summary byDay reads usage_daily', () => {
  it('includes dateless-session sources via usage_daily and honors from/to + source filters', async () => {
    const { userId, deviceId } = await seedDevice(env);
    // a session with NO dates (the opencode case) — must NOT drive the timeline
    await seedSession(env, { userId, deviceId, source: 'opencode', lastActivity: null });
    // usage_daily rows that SHOULD drive the timeline
    await seedDaily(userId, deviceId, 'opencode', '2025-08-29', 500, 1.0);
    await seedDaily(userId, deviceId, 'claude', '2026-06-10', 200, 0.5);

    const res = await asViewer(userId, '/api/summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { byDay: { day: string; totalTokens: number }[]; byDaySource: { day: string; source: string }[] };
    const days = body.byDay.map((d) => d.day).sort();
    expect(days).toContain('2025-08-29'); // opencode history now visible
    expect(days).toContain('2026-06-10');
    expect(body.byDaySource.some((r) => r.source === 'opencode' && r.day === '2025-08-29')).toBe(true);

    // from filter clips the early day
    const clipped = await asViewer(userId, '/api/summary?from=2026-01-01T00:00:00.000Z');
    const clippedDays = ((await clipped.json()) as { byDay: { day: string }[] }).byDay.map((d) => d.day);
    expect(clippedDays).not.toContain('2025-08-29');
    expect(clippedDays).toContain('2026-06-10');

    // source filter narrows to claude
    const claudeOnly = await asViewer(userId, '/api/summary?source=claude');
    const coDays = ((await claudeOnly.json()) as { byDay: { day: string }[] }).byDay.map((d) => d.day);
    expect(coDays).toEqual(['2026-06-10']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccusage-cloud/worker test usage-daily`
Expected: FAIL — `byDay` is empty / missing `2025-08-29` (still reading sessions, where opencode has NULL last_activity).

- [ ] **Step 3: Add the daily WHERE builders**

In `worker/src/queries.ts`, add after the existing `buildWhere` function:

```ts
function buildDailyWhere(userId: string, f: SummaryFilters): WhereClause {
  const parts = ['ud.user_id = ?'];
  const binds: string[] = [userId];
  if (f.from) { parts.push('ud.day >= substr(?,1,10)'); binds.push(f.from); }
  if (f.to) { parts.push('ud.day <= substr(?,1,10)'); binds.push(f.to); }
  if (f.source) { parts.push('ud.source = ?'); binds.push(f.source); }
  if (f.device) { parts.push('ud.device_id = ?'); binds.push(f.device); }
  return { sql: parts.join(' AND '), binds };
}

function buildGroupDailyWhere(f: SummaryFilters): WhereClause {
  const parts = ['ud.user_id IN (SELECT id FROM users WHERE public_to_group = 1)'];
  const binds: string[] = [];
  if (f.from) { parts.push('ud.day >= substr(?,1,10)'); binds.push(f.from); }
  if (f.to) { parts.push('ud.day <= substr(?,1,10)'); binds.push(f.to); }
  if (f.source) { parts.push('ud.source = ?'); binds.push(f.source); }
  // device filter intentionally ignored in group scope (device ids are per-user).
  return { sql: parts.join(' AND '), binds };
}
```

- [ ] **Step 4: Point `runByDay`/`runByDaySource` at `usage_daily`**

In `worker/src/queries.ts`, replace the bodies of `runByDay` and `runByDaySource` with:

```ts
async function runByDay(db: D1Database, w: WhereClause): Promise<ByDay[]> {
  return (await db.prepare(
    `SELECT ud.day AS day,
            COALESCE(SUM(ud.total_tokens),0) AS totalTokens,
            COALESCE(SUM(ud.total_cost),0) AS totalCost
     FROM usage_daily ud WHERE ${w.sql}
     GROUP BY ud.day ORDER BY ud.day`,
  ).bind(...w.binds).all<ByDay>()).results;
}

async function runByDaySource(db: D1Database, w: WhereClause): Promise<ByDaySource[]> {
  return (await db.prepare(
    `SELECT ud.day AS day,
            ud.source AS source,
            COALESCE(SUM(ud.total_tokens),0) AS totalTokens,
            COALESCE(SUM(ud.total_cost),0) AS totalCost
     FROM usage_daily ud WHERE ${w.sql}
     GROUP BY ud.day, ud.source ORDER BY ud.day, ud.source`,
  ).bind(...w.binds).all<ByDaySource>()).results;
}
```

- [ ] **Step 5: Update the two call sites to pass the daily WHERE**

In `summaryQuery` (in `worker/src/queries.ts`), replace the `Promise.all` block so the timeline queries get a daily where while the rest keep the session where:

```ts
export async function summaryQuery(db: D1Database, userId: string, filters: SummaryFilters): Promise<Summary> {
  const w = buildWhere(userId, filters);
  const wd = buildDailyWhere(userId, filters);

  const [totals, byDay, byDaySource, bySource, byModel] = await Promise.all([
    runTotals(db, w),
    runByDay(db, wd),
    runByDaySource(db, wd),
    runBySource(db, w),
    runByModel(db, w),
  ]);
```

(Leave the rest of `summaryQuery` — `byProject`, `byDevice`, the `return` — unchanged.)

In `groupSummaryQuery`, replace its `Promise.all` block:

```ts
export async function groupSummaryQuery(db: D1Database, filters: SummaryFilters): Promise<Summary> {
  const w = buildGroupWhere(filters);
  const wd = buildGroupDailyWhere(filters);
  const [totals, byDay, byDaySource, bySource, byModel] = await Promise.all([
    runTotals(db, w), runByDay(db, wd), runByDaySource(db, wd), runBySource(db, w), runByModel(db, w),
  ]);
```

(Leave the per-person `byPerson` query and the `return` unchanged.)

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `pnpm --filter @ccusage-cloud/worker test usage-daily`
Expected: PASS.

- [ ] **Step 7: Update the existing `queries.test.ts` setup to seed `usage_daily`**

`worker/test/queries.test.ts`'s `setupTwoDevicesTwoSources` seeds three sessions and the `byDay`/`byDaySource` assertions read their token counts. Since the timeline now comes from `usage_daily`, seed matching rows. In that helper, immediately before `return { userId, dA, dB };`, insert:

```ts
  // Timeline (byDay/byDaySource) now reads usage_daily — seed rows matching the sessions above.
  for (const r of [
    { d: dA, source: 'claude', day: '2026-06-20', tokens: 150, cost: 1 },
    { d: dA, source: 'claude', day: '2026-06-21', tokens: 300, cost: 2 },
    { d: dB, source: 'codex', day: '2026-06-21', tokens: 15, cost: 0.5 },
  ]) {
    await env.DB.prepare(
      'INSERT INTO usage_daily (user_id, device_id, source, day, total_tokens, total_cost, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).bind(userId, r.d, r.source, r.day, r.tokens, r.cost, 1).run();
  }
```

These produce byDay `2026-06-20`=150, `2026-06-21`=315 (300+15) and byDaySource `2026-06-20|claude`=150, `2026-06-21|claude`=300, `2026-06-21|codex`=15 — exactly the existing assertions. (`read-api.test.ts` only checks `Array.isArray(body.byDay)`, so it needs no change.)

- [ ] **Step 8: Run the full worker suite**

Run: `pnpm --filter @ccusage-cloud/worker test`
Expected: PASS (no regressions; `queries.test.ts` byDay/byDaySource assertions now satisfied via `usage_daily`).

- [ ] **Step 9: Commit**

```bash
git add worker/src/queries.ts worker/test/usage-daily.test.ts worker/test/queries.test.ts
git commit -m "feat(worker): drive byDay/byDaySource from usage_daily"
```

---

## Task 4: CLI — `loadDaily`

**Files:**
- Modify: `cli/src/ccusage.ts` (export `defaultRunner`)
- Create: `cli/src/daily.ts`
- Test: `cli/test/daily.test.ts`

**Interfaces:**
- Consumes: `Runner` type and `defaultRunner` from `./ccusage`.
- Produces: `interface DailyRow { source: string; day: string; totalTokens: number; totalCost: number }`; `loadDaily(source: string, bin: string, run?: Runner): DailyRow[]`.

- [ ] **Step 1: Export `defaultRunner`**

In `cli/src/ccusage.ts`, change:

```ts
const defaultRunner: Runner = (bin, args) =>
```
to:

```ts
export const defaultRunner: Runner = (bin, args) =>
```

- [ ] **Step 2: Write the failing test**

Create `cli/test/daily.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadDaily } from '../src/daily';
import type { Runner } from '../src/ccusage';

const claudeDaily = JSON.stringify({
  daily: [
    { date: '2026-06-08', totalTokens: 100, totalCost: 0.5, modelsUsed: ['claude-opus-4-8'] },
    { date: '2026-06-09', totalTokens: 200, totalCost: 1.0, modelsUsed: ['claude-opus-4-8'] },
    { totalTokens: 999, totalCost: 9.9 }, // no date → skipped
  ],
});
const codexDaily = JSON.stringify({ daily: [{ date: '2026-06-24', totalTokens: 50, costUSD: 0.2 }] });

describe('loadDaily', () => {
  it('parses claude daily rows and skips rows without a date', () => {
    const run: Runner = () => claudeDaily;
    const rows = loadDaily('claude', 'ccusage', run);
    expect(rows).toEqual([
      { source: 'claude', day: '2026-06-08', totalTokens: 100, totalCost: 0.5 },
      { source: 'claude', day: '2026-06-09', totalTokens: 200, totalCost: 1.0 },
    ]);
  });

  it('resolves cost from costUSD when totalCost is absent (codex)', () => {
    const run: Runner = () => codexDaily;
    const rows = loadDaily('codex', 'ccusage', run);
    expect(rows).toEqual([{ source: 'codex', day: '2026-06-24', totalTokens: 50, totalCost: 0.2 }]);
  });

  it('returns [] when the runner throws (source not installed)', () => {
    const run: Runner = () => { throw new Error('not found'); };
    expect(loadDaily('opencode', 'ccusage', run)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter ccusage-cloud test daily`
Expected: FAIL — cannot find `../src/daily`.

- [ ] **Step 4: Implement `loadDaily`**

Create `cli/src/daily.ts`:

```ts
import * as v from 'valibot';
import { type Runner, defaultRunner } from './ccusage';

export interface DailyRow {
  source: string;
  day: string;
  totalTokens: number;
  totalCost: number;
}

const FileShape = v.object({ daily: v.array(v.unknown()) });
const RowSchema = v.object({
  date: v.string(),
  totalTokens: v.number(),
  totalCost: v.optional(v.number()),
  costUSD: v.optional(v.number()),
});

export function loadDaily(source: string, bin: string, run: Runner = defaultRunner): DailyRow[] {
  let raw: string;
  try {
    raw = run(bin, [source, 'daily', '--json']);
  } catch {
    return [];
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }

  const file = v.safeParse(FileShape, json);
  if (!file.success) return [];

  const out: DailyRow[] = [];
  for (const row of file.output.daily) {
    const parsed = v.safeParse(RowSchema, row);
    if (!parsed.success) continue;
    const { date, totalTokens, totalCost, costUSD } = parsed.output;
    out.push({ source, day: date.slice(0, 10), totalTokens, totalCost: totalCost ?? costUSD ?? 0 });
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter ccusage-cloud test daily`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/ccusage.ts cli/src/daily.ts cli/test/daily.test.ts
git commit -m "feat(cli): load daily usage rollups from ccusage"
```

---

## Task 5: CLI — push daily rollups during `sync`

**Files:**
- Modify: `cli/src/sync.ts` (extract `postJson`; add `syncDaily`)
- Modify: `cli/src/index.ts` (call `syncDaily` in the `sync` command)
- Test: `cli/test/daily-sync.test.ts`

**Interfaces:**
- Consumes: `loadDaily`, `DailyRow` from `./daily`; `Config` from `./config`.
- Produces: `syncDaily(cfg: Config, sources: string[], opts?: { run?: Runner; fetchFn?: typeof fetch; chunkSize?: number; retries?: number }): Promise<{ dailyPushed: number }>`. POSTs `{ days: DailyRow[] }` to `/ingest/daily`. `syncOnce` and its return shape are unchanged.

- [ ] **Step 1: Write the failing test**

Create `cli/test/daily-sync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { syncDaily } from '../src/sync';
import type { Runner } from '../src/ccusage';
import type { Config } from '../src/config';

const cfg: Config = { serverUrl: 'https://api.example.dev', token: 'cccloud_xyz', ccusageBin: 'ccusage' };
const ok = () => new Response(JSON.stringify({ upserted: 1 }), { status: 200 });
const dailyJson = JSON.stringify({ daily: [{ date: '2025-08-29', totalTokens: 100, totalCost: 0.5 }] });

describe('syncDaily', () => {
  it('posts daily rows to /ingest/daily and reports the count', async () => {
    const run: Runner = () => dailyJson;
    let url = '';
    let body = '';
    const fetchFn = vi.fn(async (u: string | URL, init?: RequestInit) => {
      url = String(u);
      body = String(init?.body ?? '');
      return ok();
    });
    const res = await syncDaily(cfg, ['claude'], { run, fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toEqual({ dailyPushed: 1 });
    expect(url).toBe('https://api.example.dev/ingest/daily');
    expect(JSON.parse(body)).toEqual({ days: [{ source: 'claude', day: '2025-08-29', totalTokens: 100, totalCost: 0.5 }] });
  });

  it('makes no request when there are no daily rows', async () => {
    const run: Runner = () => { throw new Error('no data'); };
    const fetchFn = vi.fn(async () => ok());
    const res = await syncDaily(cfg, ['opencode'], { run, fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toEqual({ dailyPushed: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ccusage-cloud test daily-sync`
Expected: FAIL — `syncDaily` is not exported from `../src/sync`.

- [ ] **Step 3: Extract `postJson` and refactor `postBatch`**

In `cli/src/sync.ts`, replace the existing `postBatch` function with a generic `postJson` plus a thin `postBatch` that calls it (behavior identical — sessions still POST `{ sessions: batch }` to `/ingest`):

```ts
async function postJson(
  url: URL,
  body: unknown,
  token: string,
  fetchFn: typeof fetch,
  retries: number,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let status = 0;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      status = res.status;
      if (status < 500) throw new Error(`request failed: ${status} ${await res.text()}`);
      lastErr = new Error(`request failed: ${status}`);
    } catch (err) {
      if (status > 0 && status < 500) throw err; // re-throw 4xx immediately, no retry
      lastErr = err;
    }
    if (attempt < retries) await sleep(250 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error('request failed');
}

async function postBatch(
  cfg: Config,
  batch: TaggedSession[],
  fetchFn: typeof fetch,
  retries: number,
): Promise<void> {
  await postJson(new URL('/ingest', cfg.serverUrl), { sessions: batch }, cfg.token, fetchFn, retries);
}
```

- [ ] **Step 4: Add `syncDaily`**

In `cli/src/sync.ts`, add the import at the top:

```ts
import { loadDaily, type DailyRow } from './daily';
```

Append `syncDaily` at the end of the file:

```ts
export async function syncDaily(
  cfg: Config,
  sources: string[],
  opts: { run?: Runner; fetchFn?: typeof fetch; chunkSize?: number; retries?: number } = {},
): Promise<{ dailyPushed: number }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const chunkSize = opts.chunkSize ?? 500;
  const retries = opts.retries ?? 3;

  const rows: DailyRow[] = [];
  for (const source of sources) rows.push(...loadDaily(source, cfg.ccusageBin, opts.run));

  let dailyPushed = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = rows.slice(i, i + chunkSize);
    await postJson(new URL('/ingest/daily', cfg.serverUrl), { days: batch }, cfg.token, fetchFn, retries);
    dailyPushed += batch.length;
  }
  return { dailyPushed };
}
```

(`Runner` is already imported in `sync.ts` via `import { loadSessions, type Runner } from './ccusage';` — confirm it is; if only `loadSessions` is imported, add `type Runner` to that import.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter ccusage-cloud test daily-sync`
Expected: PASS.

- [ ] **Step 6: Wire `syncDaily` into the `sync` command**

In `cli/src/index.ts`, in the `sync` command block, replace:

```ts
    const { syncOnce } = await import('./sync');
    const { pushed, skipped } = await syncOnce(cfg2, sources, { full: values.full ?? false, run: runner });
    console.log(`Pushed ${pushed} sessions (${skipped} unchanged).`);
    return 0;
```

with:

```ts
    const { syncOnce, syncDaily } = await import('./sync');
    const { pushed, skipped } = await syncOnce(cfg2, sources, { full: values.full ?? false, run: runner });
    const { dailyPushed } = await syncDaily(cfg2, sources, { run: runner });
    console.log(`Pushed ${pushed} sessions (${skipped} unchanged); ${dailyPushed} daily rows.`);
    return 0;
```

- [ ] **Step 7: Run the full CLI suite**

Run: `pnpm --filter ccusage-cloud test`
Expected: PASS — existing `syncOnce` tests in `sync.test.ts` still pass unchanged (the `postBatch` refactor preserves behavior; the `/401/` assertion still matches `request failed: 401 …`).

- [ ] **Step 8: Commit**

```bash
git add cli/src/sync.ts cli/src/index.ts cli/test/daily-sync.test.ts
git commit -m "feat(cli): push daily usage rollups during sync"
```

---

## Final verification

- [ ] **Run all suites**

```bash
pnpm --filter @ccusage-cloud/worker test
pnpm --filter ccusage-cloud test
pnpm --filter dashboard test
```
Expected: all PASS.

- [ ] **Build the CLI bundle and dashboard (deploy artifacts)**

```bash
pnpm --filter ccusage-cloud build:bundle
pnpm --filter dashboard build
```
Expected: both succeed (this feature does not change `/cli.js` behavior, but the bundle must still build).

- [ ] **Deploy reminder (operational, not a code step):** after deploying, apply the new migration to production — `wrangler d1 migrations apply ccusage-cloud --remote` — then run `ccusage-cloud sync` (or the one-liner) on each device to backfill `usage_daily` across all history. The timeline should then extend back to the earliest daily data (e.g. 2025-08-29 for opencode).

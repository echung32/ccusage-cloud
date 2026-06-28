# Daily usage rollups for the time-series charts — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)

## Problem

The dashboard "tokens/cost over time" charts appear to start at 2026-06-09 even
though the user has usage history back to 2025-08-29. Root cause investigation
showed this is **not** a chart bug or a sync bug in our code:

- The importer collects per-session data via `ccusage <source> session --json`.
- ccusage's per-agent `session` adapters emit **inconsistent date fields**:
  - `claude` — has both `firstActivity` and `lastActivity`.
  - `codex` — has only `lastActivity` (no `firstActivity`); cost is `costUSD`.
  - `opencode` — has **neither** date field.
- The worker's `byDay`/`byDaySource` queries filter `WHERE last_activity IS NOT
  NULL` (`worker/src/queries.ts`), so sources whose sessions carry no dates are
  excluded from the timeline. In the user's data, opencode has 110 dateless
  sessions covering 2025-08-29 → 2026-05-12 — the bulk of the "missing" history.

The tokens/cost **totals** and **by-source** numbers are already correct
(sessions carry tokens regardless of dates); only the time-bucketed views are
wrong. `ccusage <source> daily --json` carries reliable dates for every agent
(it buckets by day from raw JSONL timestamps), so it is the right source for the
timeline.

## Decision (from brainstorming)

Add a per-`(device, source, day)` rollup table populated from `ccusage <source>
daily --json`, and back the timeline charts (`byDay`, `byDaySource`) with it.
Everything else stays on the `sessions` table.

Granularity: **per source/day, storing total tokens + total cost only** (matches
exactly what the current charts render; full token breakdown stays in
`sessions`).

## Architecture

- New `usage_daily` D1 table: per-`(user, device, source, day)` token + cost.
- CLI: after the existing session push, `sync` collects `ccusage <source> daily
  --json` for all sources and pushes the rows to a new `/ingest/daily` endpoint.
- Worker: new `/ingest/daily` ingest path upserts into `usage_daily`; the
  `byDay`/`byDaySource` queries (in both the personal and group summary) read
  from `usage_daily` instead of from `sessions.last_activity`.
- Dashboard: **no component changes** — the chart already consumes
  `byDay`/`byDaySource` from `/api/summary`; the data simply becomes complete.

`usage_daily` is purely the timeline's backing store. `sessions` remains the
source of truth for totals, by-source, by-model, by-project, by-device, and the
session list.

## Components

### 1. D1 migration `worker/migrations/0003_usage_daily.sql`

```sql
CREATE TABLE usage_daily (
  user_id      TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  source       TEXT NOT NULL,
  day          TEXT NOT NULL,         -- 'YYYY-MM-DD'
  total_tokens INTEGER NOT NULL,
  total_cost   REAL NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, source, day)
);
CREATE INDEX idx_usage_daily_user_day ON usage_daily(user_id, day);
```

### 2. CLI — collect daily rollups (`cli/src/daily.ts`, new)

`loadDaily(source: string, bin: string, run?: Runner): DailyRow[]` where
`DailyRow = { source: string; day: string; totalTokens: number; totalCost:
number }`.

- Runs `ccusage <source> daily --json` (same `Runner` injection pattern as
  `loadSessions`); returns `[]` on spawn error or unparseable output.
- Parses the daily array (top-level key `daily`). For each row: take `date` as
  `day`; `totalTokens` as-is; cost resolved as `totalCost ?? costUSD ?? 0`
  (codex daily uses `costUSD`). Rows missing `date` are skipped.

### 3. CLI — push daily rollups (`cli/src/sync.ts`)

After the session push in `syncOnce`, collect daily rows across the same source
list and POST them to `/ingest/daily` with the device Bearer token. **All daily
rows are sent every sync** (no incremental hashing): the current day's bucket
grows over time, and the volume is tiny (~days × sources). Batches use the same
chunking/retry/backoff helper as the session push. The daily push reuses the
existing `fetchFn` injection for tests.

The function's return shape gains the daily count, e.g.
`{ pushed, skipped, chunks, dailyPushed }`, and `index.ts`'s `sync` command
prints it (e.g. `Pushed N sessions (M unchanged); D daily rows.`).

### 4. Worker — `/ingest/daily` endpoint (`worker/src/index.ts`, `db.ts`, `schema.ts`)

- `schema.ts`: `DailyRowSchema = { source: string, day: string, totalTokens:
  number, totalCost: number }`; `IngestDailySchema = { days:
  array(DailyRowSchema) capped at 1000 }`.
- `index.ts`: `app.post('/ingest/daily', deviceAuth, …)` — rate-limited via the
  existing KV limiter (same 600/60 budget, key `ingest-daily:${deviceId}`),
  validates the body, calls `upsertDaily`, updates `devices.last_seen_at`,
  returns `{ upserted }`.
- `db.ts`: `upsertDaily(db, userId, deviceId, rows)` — batch upsert into
  `usage_daily` keyed by `(user_id, device_id, source, day)`, updating
  `total_tokens`, `total_cost`, `updated_at` on conflict. Mirrors
  `upsertSessions`.

### 5. Worker — timeline queries read `usage_daily` (`worker/src/queries.ts`)

- `runByDay` and `runByDaySource` (personal scope) select from `usage_daily`:
  ```sql
  SELECT day, COALESCE(SUM(total_tokens),0) AS totalTokens,
              COALESCE(SUM(total_cost),0) AS totalCost
  FROM usage_daily WHERE user_id = ? [AND source = ?] [AND device_id = ?]
       [AND day >= substr(?,1,10)] [AND day <= substr(?,1,10)]
  GROUP BY day ORDER BY day
  ```
  (`byDaySource` additionally selects/group-by `source`.) The `from`/`to`
  filters are full ISO strings; compare against `day` via `substr(from,1,10)` /
  `substr(to,1,10)`.
- The group-scope `byDay` and `byDaySource` (in `groupSummaryQuery`) similarly
  read `usage_daily` restricted to users with `public_to_group = 1`.
- A small `buildDailyWhere` helper builds the `usage_daily` WHERE clause
  (analogous to the existing `buildWhere` for sessions), so the session-based
  queries are untouched.

### 6. Dashboard

No changes. Chart components already render `byDay`/`byDaySource` from the
summary response.

## Data flow

```
CLI sync:
  ccusage <src> session --json ──► /ingest        (existing, sessions table)
  ccusage <src> daily   --json ──► /ingest/daily  (new, usage_daily table)

Dashboard GET /api/summary:
  totals, bySource, byModel, byProject, byDevice  ◄── sessions   (unchanged)
  byDay, byDaySource                              ◄── usage_daily (new)
```

## Backfill & migration

- After deploy + applying migration `0003`, the next `sync` from each device
  backfills `usage_daily` across all available history (ccusage daily reaches
  back to 2025-08-29 in the user's data). No manual backfill step.
- Existing dateless `sessions` rows (opencode) are left as-is; they continue to
  feed totals/by-source. The timeline now comes from `usage_daily`.

## Error handling

- `loadDaily` returns `[]` for a source that errors or has no data (same as
  `loadSessions`), so one bad source never aborts the sync.
- `/ingest/daily` returns 400 on invalid payload, 429 when rate-limited, 401 on
  bad token — consistent with `/ingest`.
- The daily push reuses the session push's retry/backoff; a failed daily batch
  surfaces as a sync error after retries, without corrupting already-upserted
  rows (upsert is idempotent).

## Consistency note

The sum of `usage_daily` tokens/cost for a source over a range should closely
match the `sessions`-based by-source totals (same underlying ccusage data).
Minor divergence is possible because ccusage's `daily` and `session` cost
computations can round differently. This is acceptable; the totals card stays
sessions-based and already includes dateless sources.

## Testing

- **Worker:**
  - migration `0003` creates a writable `usage_daily` table.
  - `/ingest/daily`: upsert inserts new rows; re-upserting the same
    `(source, day)` updates tokens/cost in place (not duplicate rows); auth
    required; invalid payload → 400.
  - `byDay`/`byDaySource` read from `usage_daily` and honor `from`/`to`/`source`/
    `device` filters; a dateless `sessions` row does not appear, while its
    `usage_daily` rows do.
  - group-scope `byDay` and `byDaySource` read `usage_daily` for public users
    only.
- **CLI:**
  - `loadDaily` parses the claude daily shape (`date`, `totalTokens`,
    `totalCost`) and the codex shape (`costUSD`); skips rows without `date`;
    returns `[]` on runner error.
  - `syncOnce` posts daily rows to `/ingest/daily` (assert via injected
    `fetchFn`) and reports `dailyPushed`.
- **Dashboard:** existing tests unchanged and still pass.

## Out of scope (YAGNI)

- Per-model-over-time and input/output/cache breakdown over time (timeline
  stores only total tokens + cost).
- Any dashboard UI changes.
- Removing or re-dating the existing dateless `sessions` rows.
- Incremental/hashed daily sync (all daily rows are resent each sync).

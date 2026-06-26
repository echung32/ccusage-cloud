# Fix session dedup grain + codex sync

**Date:** 2026-06-25
**Status:** Approved (design)
**Branch:** fix/session-project-dedup (off master)

## Problem

ccusage-cloud under-reports usage versus `ccusage` itself. Production evidence
(live D1 `ccusage-cloud`):

| source | ccusage `session` | stored in D1 | lost |
|---|---|---|---|
| claude | 101 rows, $1634.81, 1,841,040,866 tok | 98 rows, $1499.18, 1,725,208,188 tok | 3 rows, $134.79, 114,856,420 tok |
| opencode | 56 rows, $195.42 | 56 rows, $195.42 | — |
| codex | 51 rows, ~$23 (costUSD), 11,345,504 tok | **absent (0 rows)** | all 51 |

Webui showed 154 sessions / $1694.61 / 1,889,199,152 tokens; `ccusage` daily showed
$1852.62 / 2,015,359,247 tokens. The gap reconciles exactly to two root causes.

### Root cause 1 — D1 primary key collapses same-sessionId-across-projects

The `sessions` table PK is `(user_id, device_id, source, session_id)`. ccusage emits
the **same Claude `sessionId` under different `projectPath`s** (git worktrees), e.g.
session `47491337…` appears for `-workspaces-uh-banner-scraper` (81.5M tok, $63.94)
**and** for `…-claude-worktrees-analytics-dashboard` (16.8M tok, $21.20). The upsert
`ON CONFLICT (user_id, device_id, source, session_id)` collapses them — the
last-written row wins and the other's tokens/cost are lost. Confirmed in production:
each of the 3 duplicated sessionIds has exactly one stored row (the worktree variant).
`(sessionId, projectPath)` is verified unique across all sources, so it is a sound key.

### Root cause 2 — codex sessions silently dropped (schema mismatch)

`ccusage codex session --json` emits `costUSD`, not `totalCost` (every other required
field is present). The CLI's valibot `SessionRowSchema` requires `totalCost: number`,
so the whole-array parse fails, and `loadSessions` does `if (!parsed.success) return []`
— **silently** dropping all 51 codex sessions. That is why "Pushed 157" = 208 − 51.

### Root cause 3 (consistency) — CLI sync-state grain

`sessionKey` in `cli/src/state.ts` is `${source}\t${sessionId}` — also missing
`projectPath`. Even after fixing the worker PK, the CLI's local diff-state would
conflate worktree sessions and re-push one of them every sync (churn). The dedup grain
must be consistent across worker storage and CLI state.

## Goal

Store and track sessions at the grain ccusage actually uses —
`(user_id, device_id, source, session_id, project_path)` — and stop silently dropping
sources whose JSON shape differs. Recover the lost data via a full re-sync.

## Decisions

| Topic | Decision |
|---|---|
| Dedup grain | `(user_id, device_id, source, session_id, project_path)` in worker PK + upsert, and in CLI `sessionKey`. |
| Null project path | `project_path TEXT NOT NULL DEFAULT ''`; bind `s.projectPath ?? ''`. (SQLite treats NULLs as distinct in a PK → would break idempotent upserts.) |
| Codex cost | Map `costUSD → totalCost` at the **CLI adapter boundary** (`cli/src/types.ts` / `loadSessions`), not in the worker. |
| Parse resilience | `loadSessions` validates **per-session**, keeps valid rows, and `console.warn`s a dropped count instead of silently returning `[]` for the whole source. |
| Migration | Edit `0001_init.sql` (no forward migration); reset the remote D1; data is re-syncable. |
| Recovery | `ccusage-cloud sync --full` (with the rebuilt CLI) repopulates codex + worktree rows. |

## Changes

### 1. Worker — sessions schema + upsert

`worker/migrations/0001_init.sql`:
- `project_path TEXT NOT NULL DEFAULT ''` (was nullable).
- `PRIMARY KEY (user_id, device_id, source, session_id, project_path)` (added `project_path`).
- The existing `idx_sessions_user_activity` index is unchanged.

`worker/src/db.ts` (`UPSERT`):
- `ON CONFLICT (user_id, device_id, source, session_id, project_path)` (added `project_path`).
- Bind `project_path` as `s.projectPath ?? ''` (was `s.projectPath ?? null`). `project_path`
  is therefore no longer in the `DO UPDATE SET` list (it is part of the conflict key);
  remove it from the SET clause.

`worker/src/schema.ts`: `SessionSchema.projectPath` stays `v.nullish(v.string())` on the
wire (the CLI may still send null/absent); the worker normalizes null→`''` at bind time.

### 2. CLI — codex cost + parse resilience

`cli/src/types.ts` (`SessionRowSchema`):
- `totalCost: v.optional(v.number())` (was required).
- add `costUSD: v.optional(v.number())`.
- `TaggedSession`/downstream still carry a concrete `totalCost: number` (computed below).

`cli/src/ccusage.ts` (`loadSessions`):
- Parse the file as `{ sessions: unknown[] }`, then `v.safeParse(SessionRowSchema, row)`
  per element. Keep the successes; count failures.
- For each kept row, normalize `totalCost = row.totalCost ?? row.costUSD ?? 0`.
- If any rows were dropped, `console.warn` a one-line count
  (e.g. `ccusage <source>: skipped N session(s) that failed validation`).
- A source that errors or yields no parseable JSON still yields `[]` (unchanged), but no
  longer swallows a partially-valid array.

`cli/src/state.ts` (`sessionKey`):
- `${s.source}\t${s.sessionId}\t${s.projectPath ?? ''}` (added project path).

### 3. Read API / dashboard

No change. All summary counts are `COUNT(*)` over rows (verified in
`worker/src/queries.ts`) — not `COUNT(DISTINCT session_id)` — so they correctly reflect
the previously-collapsed rows with no query edit. Token/cost are `SUM(...)`, likewise
unaffected. Projectless sources (codex/opencode) group under `project_path = ''` in the
by-project breakdown (same grouping as today's null) — cosmetic only, out of scope.

## Recovery procedure (post-merge, manual)

1. Reset the remote D1 and apply the edited `0001_init.sql` (drop tables + `d1_migrations`,
   then `wrangler d1 migrations apply ccusage-cloud --remote`). Pairs with the
   auth-gateway deploy reset if not yet done.
2. Deploy the worker (`cd worker && pnpm deploy`).
3. Rebuild + reinstall the CLI (`cd cli && pnpm build`).
4. `ccusage-cloud sync --full` on each device — repopulates codex + worktree rows.
5. Verify webui totals now match `ccusage` (~$1853, ~2.016B tokens for the test device).

## Testing

### Worker (`worker/test`)
- **Upsert dedup:** two `SessionPayload`s with identical `(source, sessionId)` but
  different `projectPath` → `upsertSessions` stores **2 rows**; a summary query sums both.
- **Idempotency:** re-upserting the same two → still 2 rows, fields updated, `updated_at` bumped.
- **Null project path:** a session with `projectPath: null` → stored row has `project_path = ''`.
- **Migration:** `PRAGMA table_info(sessions)` shows `project_path` `notnull=1`; the PK
  (via `PRAGMA index_info`/`table_info` pk flags) includes `project_path`.
- Existing read-api / group-summary tests remain green (more rows, same aggregation shape).
- `worker/test/seed.ts` `seedSession` binds `project_path` directly and allows
  `projectPath: null`; since the column is now `NOT NULL`, change that bind to
  `projectPath ?? ''` so null-project seeds don't violate the constraint.

### CLI (`cli/test`)
- **Codex mapping:** a row with `costUSD` and no `totalCost` parses and yields
  `totalCost === costUSD`.
- **Per-session salvage:** an array with one invalid + several valid rows → valid rows
  returned, one `console.warn`, not an empty array.
- **sessionKey grain:** two sessions, same `(source, sessionId)`, different `projectPath`
  → distinct `sessionKey`s; `diffSessions` treats them independently (both pushed once,
  neither perpetually "changed" on a second diff against saved state).

## Out of scope

- Read-API/aggregation changes, group-sharing, device-token auth, auth-gateway.
- Per-project UI labeling of `''` (projectless) sources.
- Upstreaming the `costUSD` naming to ccusage.

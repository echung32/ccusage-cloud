# Session dedup grain + codex sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store and track AI-usage sessions at ccusage's real grain — `(user_id, device_id, source, session_id, project_path)` — and stop silently dropping codex sessions, so ccusage-cloud totals match `ccusage`.

**Architecture:** Two independent sides. (1) The Cloudflare Worker's `sessions` table primary key + upsert gain `project_path`, so the same Claude `sessionId` used across git worktrees is stored as distinct rows instead of overwriting each other. (2) The CLI maps codex's `costUSD`→`totalCost`, validates per-session (warn instead of silently dropping a whole source), and includes `project_path` in its local sync-state key so it tracks the same grain.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), valibot; Node CLI; Vitest (`@cloudflare/vitest-pool-workers` for the worker, plain vitest for the CLI).

## Global Constraints

- Dedup grain everywhere: `(user_id, device_id, source, session_id, project_path)`.
- `project_path` is `TEXT NOT NULL DEFAULT ''`; null project paths normalize to `''` (SQLite treats NULLs as distinct in a PK, which breaks idempotent upserts).
- Codex `costUSD`→`totalCost` mapping lives in the **CLI adapter** (`cli/src/`), never the worker.
- Preserve existing behavior: null-`sessionId` rows are still dropped (silently); a source whose command errors or yields non-JSON still returns `[]`.
- No changes to read-API aggregation (all counts are `COUNT(*)`, sums are `SUM(...)` — they already reflect row counts correctly), group sharing, device-token auth, or auth-gateway code.
- The remote D1 is reset on deploy (data is re-syncable); edit `0001_init.sql` in place — do NOT add a forward migration.
- Worker tests run from `worker/` (`pnpm test`); CLI tests from `cli/` (`pnpm test`).

## File Structure

**Worker — modified:**
- `worker/migrations/0001_init.sql` — `project_path NOT NULL DEFAULT ''`; add it to the `sessions` PRIMARY KEY.
- `worker/src/db.ts` — `UPSERT`: add `project_path` to `ON CONFLICT`, drop it from `DO UPDATE SET`, bind `?? ''`.
- `worker/test/migration.test.ts` — assert PK includes `project_path` and the column is `NOT NULL`.
- `worker/test/seed.ts` — normalize null `projectPath`→`''` in `seedSession`.
- `worker/test/ingest.test.ts` — add dedup + idempotency tests.

**CLI — modified:**
- `cli/src/types.ts` — `SessionRowSchema`: `totalCost` optional, add `costUSD`; `TaggedSession` keeps `totalCost: number`.
- `cli/src/ccusage.ts` — `loadSessions`: per-session validation, `costUSD` fallback, warn on drops.
- `cli/src/state.ts` — `sessionKey` includes `projectPath`.
- `cli/test/ccusage.test.ts` — codex mapping + per-session salvage tests.
- `cli/test/state.test.ts` — `sessionKey` grain test.

---

## Task 1: Worker — add project_path to the sessions dedup grain

After this task, the worker stores same-`sessionId`/different-`project_path` rows separately and the full worker suite is green.

**Files:**
- Modify: `worker/migrations/0001_init.sql`, `worker/src/db.ts`, `worker/test/migration.test.ts`, `worker/test/seed.ts`, `worker/test/ingest.test.ts`

**Interfaces:**
- `upsertSessions(db, userId, deviceId, sessions)` is unchanged in signature; behavior now keys on `project_path`.

- [ ] **Step 1: Write the failing dedup + idempotency tests**

In `worker/test/ingest.test.ts`, add this describe block (the file already has `session()`, `post()`, and imports `SELF, env` + `seedDevice`):
```ts
describe('POST /ingest dedup grain', () => {
  it('stores same sessionId under different projectPaths as separate rows', async () => {
    const { token, userId } = await seedDevice(env);
    const a = session({ sessionId: 'dup1', projectPath: '/repo', totalTokens: 100, totalCost: 1 });
    const b = session({ sessionId: 'dup1', projectPath: '/repo/.worktree', totalTokens: 40, totalCost: 0.4 });
    const res = await post(token, [a, b]);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(total_tokens),0) AS tok, COALESCE(SUM(total_cost),0) AS cost FROM sessions WHERE user_id = ? AND session_id = ?',
    ).bind(userId, 'dup1').first<{ n: number; tok: number; cost: number }>();
    expect(row?.n).toBe(2);
    expect(row?.tok).toBe(140);
    expect(row?.cost).toBeCloseTo(1.4);
  });

  it('is idempotent: re-posting updates in place, no new rows', async () => {
    const { token, userId } = await seedDevice(env);
    const a = session({ sessionId: 'dup2', projectPath: '/repo', totalTokens: 100 });
    const b = session({ sessionId: 'dup2', projectPath: '/repo/.worktree', totalTokens: 40 });
    await post(token, [a, b]);
    await post(token, [{ ...a, totalTokens: 111 }, b]);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(total_tokens),0) AS tok FROM sessions WHERE user_id = ? AND session_id = ?',
    ).bind(userId, 'dup2').first<{ n: number; tok: number }>();
    expect(row?.n).toBe(2);
    expect(row?.tok).toBe(151);
  });

  it('normalizes a null projectPath to empty string', async () => {
    const { token, userId } = await seedDevice(env);
    await post(token, [session({ sessionId: 'np1', projectPath: null })]);
    const row = await env.DB.prepare(
      'SELECT project_path AS p FROM sessions WHERE user_id = ? AND session_id = ?',
    ).bind(userId, 'np1').first<{ p: string }>();
    expect(row?.p).toBe('');
  });
});
```
Also update `worker/test/migration.test.ts`'s PK test body to:
```ts
  it('enforces the sessions composite primary key including project_path', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(sessions)').all<{ name: string; pk: number; notnull: number }>();
    const pkCols = cols.results.filter((c) => c.pk > 0).map((c) => c.name);
    expect(pkCols).toEqual(
      expect.arrayContaining(['user_id', 'device_id', 'source', 'session_id', 'project_path']),
    );
    const pp = cols.results.find((c) => c.name === 'project_path');
    expect(pp?.notnull).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run in `worker/`:
```bash
pnpm test ingest migration
```
Expected: FAIL — dedup test sees 1 row (collapse), null-projectPath test sees `null` not `''`, migration PK test missing `project_path`.

- [ ] **Step 3: Edit the schema**

In `worker/migrations/0001_init.sql`, replace the `sessions` table definition with (change: `project_path` line + `PRIMARY KEY`):
```sql
CREATE TABLE sessions (
  user_id               TEXT NOT NULL,
  device_id             TEXT NOT NULL,
  source                TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL,
  output_tokens         INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cache_read_tokens     INTEGER NOT NULL,
  total_tokens          INTEGER NOT NULL,
  total_cost            REAL    NOT NULL,
  credits               REAL,
  first_activity        TEXT,
  last_activity         TEXT,
  models_used           TEXT,
  model_breakdowns      TEXT,
  project_path          TEXT NOT NULL DEFAULT '',
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, source, session_id, project_path)
);
CREATE INDEX idx_sessions_user_activity ON sessions(user_id, last_activity);
```

- [ ] **Step 4: Update the upsert**

In `worker/src/db.ts`, change the `ON CONFLICT` target to include `project_path` and **remove** the `project_path = excluded.project_path` line from `DO UPDATE SET` (it is now part of the conflict key):
```ts
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
```
And change the `project_path` bind from `s.projectPath ?? null` to:
```ts
      s.projectPath ?? '',
```

- [ ] **Step 5: Normalize null in the seed helper**

In `worker/test/seed.ts`, change the `projectPath` line in `seedSession` to normalize null→`''`:
```ts
  const projectPath = opts.projectPath === undefined ? '/work/app' : (opts.projectPath ?? '');
```

- [ ] **Step 6: Re-apply migrations against a clean DB and run the suite**

Run in `worker/`:
```bash
rm -rf .wrangler/state && pnpm migrate:local && pnpm test
```
Expected: PASS — full worker suite green, including the new dedup/idempotency/null-path tests and the updated migration PK test.

- [ ] **Step 7: Commit**

```bash
git add worker/
git commit -m "fix(worker): add project_path to the sessions dedup grain"
```

---

## Task 2: CLI — codex costUSD mapping, per-session salvage, and sessionKey grain

After this task, `ccusage codex session --json` (which uses `costUSD`) is parsed and synced, malformed rows no longer silently drop a whole source, and the CLI's local sync-state tracks `(source, sessionId, projectPath)`.

**Files:**
- Modify: `cli/src/types.ts`, `cli/src/ccusage.ts`, `cli/src/state.ts`, `cli/test/ccusage.test.ts`, `cli/test/state.test.ts`

**Interfaces:**
- Consumes: `TaggedSession` (now guaranteed `totalCost: number`, `projectPath?: string | null`).
- Produces: `loadSessions(source, bin, run?)` returns normalized `TaggedSession[]`; `sessionKey(s)` = `source\tsessionId\tprojectPath`.

- [ ] **Step 1: Write the failing CLI tests**

In `cli/test/ccusage.test.ts`, add:
```ts
describe('loadSessions codex/costUSD + resilience', () => {
  it('maps costUSD to totalCost when totalCost is absent', () => {
    const run: Runner = () => JSON.stringify({ sessions: [{
      sessionId: 'cx1', inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0,
      cacheReadTokens: 3, totalTokens: 6, costUSD: 0.78,
    }] });
    const out = loadSessions('codex', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].totalCost).toBeCloseTo(0.78);
    expect(out[0].source).toBe('codex');
  });

  it('keeps valid rows and warns instead of dropping the whole source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run: Runner = () => JSON.stringify({ sessions: [
      { sessionId: 'ok', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.1 },
      { sessionId: 'bad', inputTokens: 'NOPE' },
    ] });
    const out = loadSessions('claude', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe('ok');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
```
(Add `vi` to the vitest import at the top: `import { describe, expect, it, vi } from 'vitest';`)

In `cli/test/state.test.ts`, add:
```ts
describe('sessionKey grain', () => {
  it('distinguishes same sessionId across different project paths', () => {
    const base = { source: 'claude', sessionId: 's', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 } as TaggedSession;
    const a = { ...base, projectPath: '/repo' };
    const b = { ...base, projectPath: '/repo/.worktree' };
    expect(sessionKey(a)).not.toBe(sessionKey(b));
    const { changed } = diffSessions([a, b], { hashes: { [sessionKey(a)]: sessionHash(a) }, lastSyncAt: 1 });
    expect(changed).toHaveLength(1);
    expect(changed[0].projectPath).toBe('/repo/.worktree');
  });
});
```
(Ensure the file imports `sessionKey, sessionHash, diffSessions` from `../src/state` and `TaggedSession` from `../src/types` — add any missing names to the existing imports.)

- [ ] **Step 2: Run the tests to verify they fail**

Run in `cli/`:
```bash
pnpm test ccusage state
```
Expected: FAIL — codex row fails the required-`totalCost` schema (empty output); the malformed-array case returns `[]` with no warn; `sessionKey` of `a` and `b` are equal.

- [ ] **Step 3: Relax the schema to accept costUSD**

In `cli/src/types.ts`, change `SessionRowSchema`'s `totalCost` to optional and add `costUSD`, and make `TaggedSession` carry a concrete `totalCost: number`:
```ts
export const SessionRowSchema = v.object({
  sessionId: v.nullable(v.string()),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationTokens: v.number(),
  cacheReadTokens: v.number(),
  totalTokens: v.number(),
  totalCost: v.optional(v.number()),
  costUSD: v.optional(v.number()),
  credits: v.optional(v.number()),
  firstActivity: v.nullish(v.string()),
  lastActivity: v.nullish(v.string()),
  modelsUsed: v.optional(v.array(v.string()), []),
  modelBreakdowns: v.optional(v.unknown()),
  projectPath: v.nullish(v.string()),
});

export const SessionFileSchema = v.object({
  sessions: v.array(SessionRowSchema),
});

export type SessionRow = v.InferOutput<typeof SessionRowSchema>;

export type TaggedSession = Omit<SessionRow, 'sessionId' | 'totalCost' | 'costUSD'> & {
  source: string;
  sessionId: string;
  totalCost: number;
};
```

- [ ] **Step 4: Rewrite loadSessions for per-session validation + costUSD**

Replace the body of `loadSessions` in `cli/src/ccusage.ts` (keep the imports; `SessionFileSchema` is no longer used — import `SessionRowSchema` instead):
```ts
import { execFileSync } from 'node:child_process';
import * as v from 'valibot';
import { SessionRowSchema, type TaggedSession } from './types';

export type Runner = (bin: string, args: string[]) => string;

const defaultRunner: Runner = (bin, args) =>
  execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const FileShape = v.object({ sessions: v.array(v.unknown()) });

export function loadSessions(
  source: string,
  bin: string,
  run: Runner = defaultRunner,
): TaggedSession[] {
  let raw: string;
  try {
    raw = run(bin, [source, 'session', '--json']);
  } catch {
    return []; // source not installed / no data
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }

  const file = v.safeParse(FileShape, json);
  if (!file.success) return [];

  const out: TaggedSession[] = [];
  let dropped = 0;
  for (const row of file.output.sessions) {
    const parsed = v.safeParse(SessionRowSchema, row);
    if (!parsed.success) {
      dropped += 1;
      continue;
    }
    const { sessionId, costUSD, totalCost, ...rest } = parsed.output;
    if (sessionId === null) continue; // incomplete session — dropped silently, as before
    out.push({ ...rest, sessionId, source, totalCost: totalCost ?? costUSD ?? 0 });
  }
  if (dropped > 0) {
    console.warn(`ccusage ${source}: skipped ${dropped} session(s) that failed validation`);
  }
  return out;
}
```

- [ ] **Step 5: Add projectPath to sessionKey**

In `cli/src/state.ts`, change `sessionKey`:
```ts
export function sessionKey(s: TaggedSession): string {
  return `${s.source}\t${s.sessionId}\t${s.projectPath ?? ''}`;
}
```

- [ ] **Step 6: Run the CLI suite**

Run in `cli/`:
```bash
pnpm test
```
Expected: PASS — the new codex/resilience/grain tests pass and the existing `loadSessions` test (claude fixture: 1 row, drops null sessionId, `totalCost: 0.42`, `projectPath`) still passes.

- [ ] **Step 7: Build to confirm types compile**

Run in `cli/`:
```bash
pnpm build
```
Expected: no TypeScript errors (the `TaggedSession.totalCost: number` override resolves cleanly).

- [ ] **Step 8: Commit**

```bash
git add cli/
git commit -m "fix(cli): map codex costUSD, salvage valid sessions, key state by project"
```

---

## Recovery procedure (post-merge, manual)

1. Reset the remote D1 and apply the edited `0001_init.sql` (drop `sessions`/`devices`/`users`/`d1_migrations`, then `wrangler d1 migrations apply ccusage-cloud --remote`). Pairs with the auth-gateway reset if not yet done.
2. Deploy the worker: `cd worker && pnpm deploy`.
3. Rebuild + reinstall the CLI: `cd cli && pnpm build`.
4. `ccusage-cloud sync --full` on each device — repopulates codex + worktree rows.
5. Verify the webui totals now match `ccusage` (~$1853 / ~2.016B tokens for the test device).

## Self-Review notes

- **Spec coverage:** RC1 PK collapse → Task 1 (schema + upsert + dedup tests). RC2 codex schema → Task 2 (Steps 3–4). RC3 CLI state grain → Task 2 (Step 5). Migration/recovery → recovery section. All covered.
- **Behavior preserved:** null-`sessionId` rows still dropped silently (Step 4 `continue` without `dropped++`); command-error/non-JSON still `[]`.
- **Type consistency:** `TaggedSession.totalCost` is `number` everywhere (override in `types.ts`); `loadSessions` always sets it; worker `SessionSchema.totalCost` stays required `number` and receives the normalized value.
- **No read-API change:** counts are `COUNT(*)`, sums are `SUM(...)`; more rows flow through unchanged queries.

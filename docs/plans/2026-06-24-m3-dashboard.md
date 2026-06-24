# ccusage-cloud M3: Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete read-only viewer dashboard for ccusage-cloud (`scope=me` only): a Worker read API (`/api/summary`, `/api/sessions`) backed by SQL aggregation over the `sessions` table, plus a static Astro + React + Tailwind + shadcn/ui + Recharts single-page app served from the same Worker via the Assets binding. All views from the spec land in M3: Login gate, Overview, By model, By source, By project, By device, Sessions table, Settings, Devices.

**Architecture:** One Worker, one origin. The existing Hono app (`worker/src/index.ts`) gains two new viewer-guarded JSON endpoints (mounted on the existing `apiRoutes` router so they inherit the `/api/*` viewer cookie guard) and an `ASSETS: Fetcher` fallthrough that serves the built Astro app for every non-API path. Aggregation is pure SQL (`GROUP BY` + `SUM`/`COUNT`, `json_each` for per-model). The dashboard is a NEW third pnpm workspace package `dashboard/`: Astro static output, React islands hydrated client-side that fetch the same-origin JSON API (no CORS, no SSR). The Worker's `assets.directory` points at the dashboard build output.

**Tech Stack:** Worker: Hono 4, valibot 1, D1, `@cloudflare/vitest-pool-workers`. Dashboard: Astro 5 (`output: 'static'`), `@astrojs/react`, React 19, Tailwind CSS 4, shadcn/ui (Radix), Recharts 2, Vitest + `@testing-library/react` + jsdom for component tests. Node ≥20, TypeScript strict ESM.

## Drift check (run 2026-06-24, before writing this plan)

- **Auth surface — present:** `worker/src/viewer.ts` exports `requireViewer` (Hono middleware, sets `c.var.viewer = { userId }`). `worker/src/api.ts` has `apiRoutes = new Hono<AppBindings>()`, `apiRoutes.use('/api/*', requireViewer)`, and `/api/me` (GET+PATCH), `/api/devices` (POST + DELETE :id). M3's read API extends this same `apiRoutes` router (or a sibling mounted the same way) so it inherits the `/api/*` viewer guard.
- **sessions columns — match design (M1 migration `worker/migrations/0001_init.sql`):** `user_id, device_id, source, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens, total_cost, credits, first_activity, last_activity, models_used, model_breakdowns, project_path, updated_at`. PK `(user_id, device_id, source, session_id)`. Index `idx_sessions_user_activity(user_id, last_activity)`. `last_activity` is **TEXT (ISO-8601 string)** → `from`/`to` range filters are lexicographic string comparisons (valid for ISO-8601). `models_used` = JSON array of model-name strings; `model_breakdowns` = JSON (per-model breakdown, shape may vary across sources — store/treat verbatim, tolerate missing keys).
- **Single-Worker topology — confirmed:** `worker/src/index.ts` is the Hono entry mounting `/health`, `/ingest`, `app.route('/', authRoutes)`, `app.route('/', apiRoutes)`, `export default app`. No `ASSETS` binding exists yet — M3 adds it. Dashboard is static Astro served via the Worker Assets binding (`env.ASSETS.fetch`) for all non-API paths; client-rendered, no SSR, same origin (no CORS).
- **Verified at write time (extra):** `worker/src/db.ts` stores `model_breakdowns` via `JSON.stringify(s.modelBreakdowns ?? null)` and `models_used` via `JSON.stringify(s.modelsUsed)`; both are JSON-text columns. The CLI/worker schemas declare `modelBreakdowns: v.optional(v.unknown())` — the element shape is NOT pinned in this repo, so the byModel task MUST verify keys against a real sample (see Task A2). `worker/test/api.test.ts` already defines the `asViewer(userId, path, init)` helper (seeds `VIEWER_SESSIONS` via `putViewerSession`, sends `cookie: ccusage_session=<sid>`); M3 reuses this exact pattern. `worker/test/seed.ts` has `seedUser`/`seedDevice` but NO `seedSession` yet. `pnpm-workspace.yaml` lists only `worker`, `cli`. `worker/wrangler.jsonc` has `$schema, name, main, compatibility_date "2026-06-01", compatibility_flags ["nodejs_compat"], workers_dev false, preview_urls false, observability.enabled true, d1_databases, kv_namespaces, send_email` — NO `assets` block yet. `tsconfig.base.json`: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`, ESM.

## Global Constraints

- Worker package name: `@ccusage-cloud/worker`. Worker tests: `pnpm --filter @ccusage-cloud/worker test <name>`. Dashboard package name: `dashboard`. Dashboard tests/build: `pnpm --filter dashboard test <name>` / `pnpm --filter dashboard build`.
- Worker local imports are extensionless (e.g. `import { x } from './queries'`); dashboard local imports use Astro/Vite conventions (extensionless `.ts`, explicit `.astro`/`.tsx` where required by Astro).
- API JSON is camelCase, scoped strictly by `user_id` from the viewer session. `scope=me` ONLY — never query or expose another user's data anywhere in M3 (group sharing is M4).
- `last_activity`/`first_activity` are ISO-8601 TEXT. `from`/`to` filters compare as strings (`last_activity >= ? AND last_activity <= ?`). `byDay` groups on `substr(last_activity,1,10)`.
- Sessions cursor pagination: deterministic sort `(last_activity DESC, source DESC, session_id DESC)`; cursor = base64 of JSON `[lastActivity, source, sessionId]` of the last returned row. Default limit 50, max 200.
- `wrangler.jsonc` MUST retain all existing keys: `$schema`, `name`, `main`, `compatibility_date "2026-06-01"`, `compatibility_flags ["nodejs_compat"]`, `workers_dev false`, `preview_urls false`, `observability.enabled true`, `d1_databases`, `kv_namespaces`, `send_email`. M3 ADDS one `assets` block (binding `ASSETS`, directory pointing at the dashboard build output, `not_found_handling: "single-page-application"`). API/auth/ingest/health routes MUST win over assets (assets fallthrough registered LAST in `index.ts`).
- Every code step contains complete runnable code. TDD order per task: write failing test → run (FAIL) → implement → run (PASS) → `git commit`.
- Do NOT modify ccusage itself. The dashboard fetches only the ccusage-cloud Worker API.

## File Structure

**worker (`@ccusage-cloud/worker`)**
- Modify `worker/src/env.ts` — add `ASSETS: Fetcher` to `Env`.
- Create `worker/src/queries.ts` — `summaryQuery`, `sessionsPage`, filter/cursor helpers + exported types.
- Create `worker/src/read_api.ts` — Hono router `readApiRoutes` with `GET /api/summary`, `GET /api/sessions` (viewer-guarded).
- Modify `worker/src/index.ts` — mount `readApiRoutes`, add `app.all('*', …)` ASSETS fallthrough LAST.
- Modify `worker/wrangler.jsonc` — add `assets` block.
- Modify `worker/test/seed.ts` — add `seedSession` helper.
- Create `worker/test/seed-session.test.ts` — exercises `seedSession`.
- Create `worker/test/queries.test.ts` — `summaryQuery` + `sessionsPage` unit tests.
- Create `worker/test/read-api.test.ts` — `/api/summary` + `/api/sessions` HTTP tests.
- Create `worker/test/assets.test.ts` — ASSETS fallthrough test.

**dashboard (`dashboard`) — NEW package**
- Modify `pnpm-workspace.yaml` — add `dashboard`.
- Create `dashboard/package.json`, `dashboard/astro.config.mjs`, `dashboard/tsconfig.json`, `dashboard/tailwind.config.ts`, `dashboard/src/styles/global.css`, `dashboard/vitest.config.ts`, `dashboard/vitest.setup.ts`, `dashboard/components.json` (shadcn), `dashboard/.gitignore`.
- Create `dashboard/src/lib/utils.ts` (shadcn `cn`), `dashboard/src/lib/api.ts` (typed client + types), `dashboard/src/lib/types.ts` (shared API types).
- Create `dashboard/src/components/ui/*.tsx` (shadcn primitives: button, card, input, table, switch, tabs).
- Create islands: `dashboard/src/components/FilterBar.tsx`, `LoginGate.tsx`, `Overview.tsx`, `BySourceModel.tsx`, `ByProject.tsx`, `ByDevice.tsx`, `SessionsTable.tsx`, `SettingsDevices.tsx`, `AppShell.tsx`.
- Create state: `dashboard/src/lib/filters.ts` (shared filter store).
- Create pages: `dashboard/src/pages/index.astro`, `overview.astro`, `sources.astro`, `projects.astro`, `devices.astro`, `sessions.astro`, `settings.astro`, `login.astro`; layout `dashboard/src/layouts/Base.astro`.
- Create component tests under `dashboard/src/components/__tests__/*.test.tsx` and `dashboard/src/lib/__tests__/api.test.ts`.
- Create e2e `dashboard/e2e/login-overview.test.ts`.

---

# Phase A — Read API (Worker), TDD with vitest-pool-workers

## Task A1: `seedSession` test helper

**Files:**
- Modify: `worker/test/seed.ts`
- Test: `worker/test/seed-session.test.ts` (Create)

**Interfaces:**
- Produces: `seedSession(env: Env, opts: SeedSessionOpts): Promise<{ userId: string; deviceId: string; source: string; sessionId: string }>` where
  `SeedSessionOpts = { userId: string; deviceId: string; source?: string; sessionId?: string; inputTokens?: number; outputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number; totalTokens?: number; totalCost?: number; lastActivity?: string; firstActivity?: string; modelsUsed?: string[]; modelBreakdowns?: unknown; projectPath?: string | null }`.
- Consumes: `Env` from `../src/env`.

Steps:
- [ ] Write the failing test `worker/test/seed-session.test.ts`:
  ```ts
  import { env } from 'cloudflare:test';
  import { describe, expect, it } from 'vitest';
  import { seedUser, seedDevice, seedSession } from './seed';

  describe('seedSession', () => {
    it('inserts a sessions row scoped to the user and device', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `dev-${userId}@example.com`);
      const { sessionId } = await seedSession(env, {
        userId,
        deviceId,
        source: 'claude',
        totalTokens: 1234,
        totalCost: 0.5,
        lastActivity: '2026-06-20T10:00:00.000Z',
        modelsUsed: ['claude-opus-4'],
        projectPath: '/work/app',
      });
      const row = await env.DB.prepare(
        'SELECT user_id, device_id, source, total_tokens, total_cost, last_activity, models_used, project_path FROM sessions WHERE user_id = ? AND session_id = ?',
      )
        .bind(userId, sessionId)
        .first<{
          user_id: string;
          device_id: string;
          source: string;
          total_tokens: number;
          total_cost: number;
          last_activity: string;
          models_used: string;
          project_path: string;
        }>();
      expect(row?.user_id).toBe(userId);
      expect(row?.device_id).toBe(deviceId);
      expect(row?.source).toBe('claude');
      expect(row?.total_tokens).toBe(1234);
      expect(row?.total_cost).toBeCloseTo(0.5);
      expect(row?.last_activity).toBe('2026-06-20T10:00:00.000Z');
      expect(JSON.parse(row!.models_used)).toEqual(['claude-opus-4']);
      expect(row?.project_path).toBe('/work/app');
    });

    it('applies sensible defaults and a unique session id per call', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `dev2-${userId}@example.com`);
      const a = await seedSession(env, { userId, deviceId });
      const b = await seedSession(env, { userId, deviceId });
      expect(a.sessionId).not.toBe(b.sessionId);
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
        .bind(userId)
        .first<{ n: number }>();
      expect(count?.n).toBe(2);
    });
  });
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test seed-session` — EXPECT FAIL (`seedSession` is not exported).
- [ ] Implement: append to `worker/test/seed.ts`:
  ```ts
  export interface SeedSessionOpts {
    userId: string;
    deviceId: string;
    source?: string;
    sessionId?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    totalTokens?: number;
    totalCost?: number;
    firstActivity?: string;
    lastActivity?: string;
    modelsUsed?: string[];
    modelBreakdowns?: unknown;
    projectPath?: string | null;
  }

  export async function seedSession(
    env: Env,
    opts: SeedSessionOpts,
  ): Promise<{ userId: string; deviceId: string; source: string; sessionId: string }> {
    counter += 1;
    const source = opts.source ?? 'claude';
    const sessionId = opts.sessionId ?? `sess_${counter}`;
    const input = opts.inputTokens ?? 100;
    const output = opts.outputTokens ?? 50;
    const cacheCreation = opts.cacheCreationTokens ?? 0;
    const cacheRead = opts.cacheReadTokens ?? 0;
    const totalTokens = opts.totalTokens ?? input + output + cacheCreation + cacheRead;
    const totalCost = opts.totalCost ?? 0.01;
    const lastActivity = opts.lastActivity ?? '2026-06-20T00:00:00.000Z';
    const firstActivity = opts.firstActivity ?? lastActivity;
    const modelsUsed = opts.modelsUsed ?? ['claude-opus-4'];
    const modelBreakdowns =
      opts.modelBreakdowns ??
      modelsUsed.map((m) => ({
        modelName: m,
        inputTokens: input,
        outputTokens: output,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        cost: totalCost,
      }));
    const projectPath = opts.projectPath === undefined ? '/work/app' : opts.projectPath;
    await env.DB.prepare(
      `INSERT INTO sessions (
        user_id, device_id, source, session_id,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        total_tokens, total_cost, credits, first_activity, last_activity,
        models_used, model_breakdowns, project_path, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        opts.userId,
        opts.deviceId,
        source,
        sessionId,
        input,
        output,
        cacheCreation,
        cacheRead,
        totalTokens,
        totalCost,
        null,
        firstActivity,
        lastActivity,
        JSON.stringify(modelsUsed),
        JSON.stringify(modelBreakdowns),
        projectPath,
        Date.now(),
      )
      .run();
    return { userId: opts.userId, deviceId: opts.deviceId, source, sessionId };
  }
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test seed-session` — EXPECT PASS (2 tests).
- [ ] `git commit -m "test(worker): add seedSession helper for aggregation tests"`

## Task A2: `summaryQuery` aggregation (queries.ts)

**Files:**
- Create: `worker/src/queries.ts`
- Test: `worker/test/queries.test.ts` (Create)

**Interfaces:**
- Produces:
  ```ts
  export interface SummaryFilters { from?: string; to?: string; source?: string; device?: string }
  export interface SummaryTotals { sessions: number; totalTokens: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalCost: number }
  export interface ByDay { day: string; totalTokens: number; totalCost: number }
  export interface BySource { source: string; totalTokens: number; totalCost: number; sessions: number }
  export interface ByModel { model: string; totalTokens: number; totalCost: number }
  export interface ByProject { projectPath: string; totalTokens: number; totalCost: number; sessions: number }
  export interface ByDevice { deviceId: string; label: string; totalTokens: number; totalCost: number; sessions: number }
  export interface Summary { totals: SummaryTotals; byDay: ByDay[]; bySource: BySource[]; byModel: ByModel[]; byProject: ByProject[]; byDevice: ByDevice[] }
  export function summaryQuery(db: D1Database, userId: string, filters: SummaryFilters): Promise<Summary>
  ```
- Consumes: `D1Database` (worker-types global).

**byModel aggregation decision (VERIFIED against live ccusage output 2026-06-24 — paths are final):**
- The `model_breakdowns` element shape was confirmed by running `bunx ccusage claude session --json` and inspecting `.sessions[0].modelBreakdowns[0]`. Each element is exactly:
  `{ modelName: string, inputTokens: number, outputTokens: number, cacheCreationTokens: number, cacheReadTokens: number, cost: number }` — there is **no** per-model `totalTokens`; per-model total = the sum of the four token fields. `modelsUsed` is a JSON array of model-name strings (e.g. `["claude-opus-4-8","claude-sonnet-4-6"]`). The `json_extract` paths below (`$.modelName`, `$.inputTokens`, `$.outputTokens`, `$.cacheCreationTokens`, `$.cacheReadTokens`, `$.cost`) are therefore pinned and require NO further verification. (To re-confirm later: `bunx ccusage claude session --json | jq '.sessions[0].modelBreakdowns[0]'`.)
- [ ] Fallback rule: if `model_breakdowns` is NULL/invalid/lacks usable numeric per-model fields for a row, that row contributes nothing to byModel via `json_each(model_breakdowns)`. The seed helper (A1) always writes valid `model_breakdowns`, so tests exercise the primary path. (If a real deployment shows widespread missing breakdowns, a follow-up may fall back to `json_each(models_used)` attributing tokens 0 / cost 0; not required for M3 since the data path is populated.) COALESCE every extracted numeric to 0.

Steps:
- [ ] Write the failing test `worker/test/queries.test.ts`:
  ```ts
  import { env } from 'cloudflare:test';
  import { describe, expect, it } from 'vitest';
  import { seedUser, seedDevice, seedSession } from './seed';
  import { summaryQuery } from '../src/queries';

  async function setupTwoDevicesTwoSources() {
    const { userId } = await seedUser(env);
    const { deviceId: dA } = await seedDevice(env, `a-${userId}@example.com`, 'laptop');
    const { deviceId: dB } = await seedDevice(env, `b-${userId}@example.com`, 'desktop');
    // device A, claude, two models
    await seedSession(env, {
      userId, deviceId: dA, source: 'claude', sessionId: 's1',
      inputTokens: 100, outputTokens: 50, totalTokens: 150, totalCost: 1,
      lastActivity: '2026-06-20T10:00:00.000Z', projectPath: '/work/app',
      modelsUsed: ['claude-opus-4'],
      modelBreakdowns: [{ modelName: 'claude-opus-4', inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 1 }],
    });
    await seedSession(env, {
      userId, deviceId: dA, source: 'claude', sessionId: 's2',
      inputTokens: 200, outputTokens: 100, totalTokens: 300, totalCost: 2,
      lastActivity: '2026-06-21T10:00:00.000Z', projectPath: '/work/app',
      modelsUsed: ['claude-sonnet-4'],
      modelBreakdowns: [{ modelName: 'claude-sonnet-4', inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 2 }],
    });
    // device B, codex
    await seedSession(env, {
      userId, deviceId: dB, source: 'codex', sessionId: 's3',
      inputTokens: 10, outputTokens: 5, totalTokens: 15, totalCost: 0.5,
      lastActivity: '2026-06-21T12:00:00.000Z', projectPath: '/work/other',
      modelsUsed: ['gpt-5'],
      modelBreakdowns: [{ modelName: 'gpt-5', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0.5 }],
    });
    return { userId, dA, dB };
  }

  describe('summaryQuery', () => {
    it('computes totals/byDay/bySource/byModel/byProject/byDevice', async () => {
      const { userId } = await setupTwoDevicesTwoSources();
      const s = await summaryQuery(env.DB, userId, {});
      expect(s.totals.sessions).toBe(3);
      expect(s.totals.totalTokens).toBe(465);
      expect(s.totals.inputTokens).toBe(310);
      expect(s.totals.outputTokens).toBe(155);
      expect(s.totals.totalCost).toBeCloseTo(3.5);

      const days = Object.fromEntries(s.byDay.map((d) => [d.day, d.totalTokens]));
      expect(days['2026-06-20']).toBe(150);
      expect(days['2026-06-21']).toBe(315);

      const src = Object.fromEntries(s.bySource.map((r) => [r.source, r.sessions]));
      expect(src['claude']).toBe(2);
      expect(src['codex']).toBe(1);

      const models = Object.fromEntries(s.byModel.map((r) => [r.model, r.totalTokens]));
      expect(models['claude-opus-4']).toBe(150);
      expect(models['claude-sonnet-4']).toBe(300);
      expect(models['gpt-5']).toBe(15);

      const proj = Object.fromEntries(s.byProject.map((r) => [r.projectPath, r.totalTokens]));
      expect(proj['/work/app']).toBe(450);
      expect(proj['/work/other']).toBe(15);

      const dev = Object.fromEntries(s.byDevice.map((r) => [r.label, r.totalTokens]));
      expect(dev['laptop']).toBe(450);
      expect(dev['desktop']).toBe(15);
    });

    it('isolates by user — a second user never leaks in', async () => {
      const { userId } = await setupTwoDevicesTwoSources();
      const { userId: other } = await seedUser(env);
      const { deviceId: od } = await seedDevice(env, `o-${other}@example.com`, 'other');
      await seedSession(env, { userId: other, deviceId: od, totalTokens: 99999, totalCost: 999, lastActivity: '2026-06-21T10:00:00.000Z' });
      const s = await summaryQuery(env.DB, userId, {});
      expect(s.totals.totalTokens).toBe(465);
      expect(s.byDevice.some((d) => d.label === 'other')).toBe(false);
    });

    it('applies from/to/source/device filters', async () => {
      const { userId, dA } = await setupTwoDevicesTwoSources();
      const fromTo = await summaryQuery(env.DB, userId, { from: '2026-06-21T00:00:00.000Z', to: '2026-06-21T23:59:59.999Z' });
      expect(fromTo.totals.sessions).toBe(2);
      const onlyClaude = await summaryQuery(env.DB, userId, { source: 'claude' });
      expect(onlyClaude.totals.sessions).toBe(2);
      const onlyDeviceA = await summaryQuery(env.DB, userId, { device: dA });
      expect(onlyDeviceA.totals.sessions).toBe(2);
    });

    it('buckets NULL project_path as (unknown)', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `np-${userId}@example.com`);
      await seedSession(env, { userId, deviceId, projectPath: null, totalTokens: 7, totalCost: 0.1 });
      const s = await summaryQuery(env.DB, userId, {});
      expect(s.byProject.find((p) => p.projectPath === '(unknown)')?.totalTokens).toBe(7);
    });
  });
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test queries` — EXPECT FAIL (`queries.ts` missing).
- [ ] Implement `worker/src/queries.ts`:
  ```ts
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
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test queries` — EXPECT PASS (4 tests).
- [ ] `git commit -m "feat(worker): summaryQuery SQL aggregation with cross-user isolation"`

## Task A3: `GET /api/summary` (read_api.ts)

**Files:**
- Create: `worker/src/read_api.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/read-api.test.ts` (Create)

**Interfaces:**
- Produces: `readApiRoutes: Hono<AppBindings>` exporting `GET /api/summary` (viewer-guarded) → `Summary` JSON; later (A4) `GET /api/sessions`.
- Consumes: `summaryQuery` (A2), `requireViewer` (`./viewer`), `AppBindings` (`./env`).
- Wiring: `index.ts` adds `app.route('/', readApiRoutes)` AFTER `apiRoutes` and BEFORE the ASSETS fallthrough (added in A5).

Steps:
- [ ] Write the failing test `worker/test/read-api.test.ts` (summary part only for now):
  ```ts
  import { SELF, env } from 'cloudflare:test';
  import { describe, expect, it } from 'vitest';
  import { putViewerSession } from '../src/kv';
  import { seedUser, seedDevice, seedSession } from './seed';

  async function asViewer(userId: string, path: string, init: RequestInit = {}) {
    const sid = `sid_${userId}`;
    await putViewerSession(env, sid, userId);
    return SELF.fetch(`https://example.com${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: `ccusage_session=${sid}` },
    });
  }

  describe('GET /api/summary', () => {
    it('401s unauthenticated', async () => {
      expect((await SELF.fetch('https://example.com/api/summary')).status).toBe(401);
    });

    it('returns the summary shape for the viewer', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `s-${userId}@example.com`, 'laptop');
      await seedSession(env, { userId, deviceId, source: 'claude', totalTokens: 100, totalCost: 1, lastActivity: '2026-06-20T10:00:00.000Z' });
      const res = await asViewer(userId, '/api/summary');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totals: { sessions: number; totalTokens: number }; byDay: unknown[]; bySource: unknown[]; byModel: unknown[]; byProject: unknown[]; byDevice: unknown[] };
      expect(body.totals.sessions).toBe(1);
      expect(body.totals.totalTokens).toBe(100);
      expect(Array.isArray(body.byDay)).toBe(true);
      expect(Array.isArray(body.bySource)).toBe(true);
      expect(Array.isArray(body.byModel)).toBe(true);
      expect(Array.isArray(body.byProject)).toBe(true);
      expect(Array.isArray(body.byDevice)).toBe(true);
    });

    it('passes filters through', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `f-${userId}@example.com`);
      await seedSession(env, { userId, deviceId, source: 'claude', totalTokens: 10, lastActivity: '2026-06-20T00:00:00.000Z' });
      await seedSession(env, { userId, deviceId, source: 'codex', totalTokens: 20, lastActivity: '2026-06-21T00:00:00.000Z' });
      const res = await asViewer(userId, '/api/summary?source=codex');
      const body = (await res.json()) as { totals: { sessions: number } };
      expect(body.totals.sessions).toBe(1);
    });

    it('isolates users', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `i-${userId}@example.com`);
      await seedSession(env, { userId, deviceId, totalTokens: 5, lastActivity: '2026-06-20T00:00:00.000Z' });
      const { userId: other } = await seedUser(env);
      const { deviceId: od } = await seedDevice(env, `i2-${other}@example.com`);
      await seedSession(env, { userId: other, deviceId: od, totalTokens: 9999, lastActivity: '2026-06-20T00:00:00.000Z' });
      const res = await asViewer(userId, '/api/summary');
      const body = (await res.json()) as { totals: { totalTokens: number } };
      expect(body.totals.totalTokens).toBe(5);
    });
  });
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test read-api` — EXPECT FAIL (`/api/summary` not registered → 401 test passes by accident but shape test 404s/fails; `read_api.ts` missing).
- [ ] Implement `worker/src/read_api.ts`:
  ```ts
  import { Hono } from 'hono';
  import * as v from 'valibot';
  import type { AppBindings } from './env';
  import { requireViewer } from './viewer';
  import { summaryQuery, type SummaryFilters } from './queries';

  export const readApiRoutes = new Hono<AppBindings>();

  readApiRoutes.use('/api/*', requireViewer);

  const FiltersSchema = v.object({
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    source: v.optional(v.string()),
    device: v.optional(v.string()),
  });

  function parseFilters(c: { req: { query: () => Record<string, string> } }): SummaryFilters {
    const raw = c.req.query();
    const parsed = v.safeParse(FiltersSchema, {
      from: raw.from || undefined,
      to: raw.to || undefined,
      source: raw.source || undefined,
      device: raw.device || undefined,
    });
    return parsed.success ? parsed.output : {};
  }

  readApiRoutes.get('/api/summary', async (c) => {
    const { userId } = c.var.viewer;
    const filters = parseFilters(c);
    const summary = await summaryQuery(c.env.DB, userId, filters);
    return c.json(summary);
  });
  ```
- [ ] Modify `worker/src/index.ts`: add `import { readApiRoutes } from './read_api';` after the `apiRoutes` import, and add `app.route('/', readApiRoutes);` immediately after `app.route('/', apiRoutes);`:
  ```ts
  import { apiRoutes } from './api';
  import { readApiRoutes } from './read_api';
  // ...
  app.route('/', authRoutes);
  app.route('/', apiRoutes);
  app.route('/', readApiRoutes);

  export default app;
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test read-api` — EXPECT PASS (4 tests).
- [ ] `git commit -m "feat(worker): GET /api/summary viewer-guarded read endpoint"`

## Task A4: `sessionsPage` + `GET /api/sessions` (cursor pagination)

**Files:**
- Modify: `worker/src/queries.ts`
- Modify: `worker/src/read_api.ts`
- Modify: `worker/test/queries.test.ts` (append)
- Modify: `worker/test/read-api.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export interface SessionRow { source: string; sessionId: string; deviceId: string; totalTokens: number; totalCost: number; firstActivity: string | null; lastActivity: string | null; modelsUsed: string[]; projectPath: string | null }
  export interface SessionsPage { sessions: SessionRow[]; nextCursor: string | null }
  export function encodeCursor(row: { lastActivity: string | null; source: string; sessionId: string }): string
  export function decodeCursor(cursor: string): { lastActivity: string; source: string; sessionId: string } | null
  export function sessionsPage(db: D1Database, userId: string, filters: SummaryFilters, cursor: string | null, limit: number): Promise<SessionsPage>
  ```
  Endpoint `GET /api/sessions` → `SessionsPage`. limit clamped to `[1,200]`, default 50.

Steps:
- [ ] Append to `worker/test/queries.test.ts`:
  ```ts
  import { sessionsPage } from '../src/queries';

  describe('sessionsPage', () => {
    async function seedN(userId: string, deviceId: string, n: number) {
      for (let i = 0; i < n; i++) {
        const day = String(10 + i).padStart(2, '0');
        await seedSession(env, {
          userId, deviceId, source: 'claude', sessionId: `p${i}`,
          totalTokens: i, totalCost: i / 10,
          lastActivity: `2026-06-${day}T10:00:00.000Z`,
        });
      }
    }

    it('paginates descending with a stable cursor', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `pg-${userId}@example.com`);
      await seedN(userId, deviceId, 5);
      const first = await sessionsPage(env.DB, userId, {}, null, 2);
      expect(first.sessions).toHaveLength(2);
      expect(first.sessions[0]!.sessionId).toBe('p4'); // newest
      expect(first.sessions[1]!.sessionId).toBe('p3');
      expect(first.nextCursor).not.toBeNull();
      const second = await sessionsPage(env.DB, userId, {}, first.nextCursor, 2);
      expect(second.sessions[0]!.sessionId).toBe('p2');
      expect(second.sessions[1]!.sessionId).toBe('p1');
      const third = await sessionsPage(env.DB, userId, {}, second.nextCursor, 2);
      expect(third.sessions).toHaveLength(1);
      expect(third.sessions[0]!.sessionId).toBe('p0');
      expect(third.nextCursor).toBeNull();
    });

    it('does not leak other users rows', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `pg2-${userId}@example.com`);
      await seedN(userId, deviceId, 2);
      const { userId: other } = await seedUser(env);
      const { deviceId: od } = await seedDevice(env, `pg3-${other}@example.com`);
      await seedSession(env, { userId: other, deviceId: od, sessionId: 'X', totalTokens: 1, lastActivity: '2026-07-01T00:00:00.000Z' });
      const page = await sessionsPage(env.DB, userId, {}, null, 50);
      expect(page.sessions.some((s) => s.sessionId === 'X')).toBe(false);
      expect(page.sessions).toHaveLength(2);
    });

    it('applies filters', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `pg4-${userId}@example.com`);
      await seedSession(env, { userId, deviceId, source: 'claude', sessionId: 'c', lastActivity: '2026-06-20T00:00:00.000Z' });
      await seedSession(env, { userId, deviceId, source: 'codex', sessionId: 'x', lastActivity: '2026-06-21T00:00:00.000Z' });
      const page = await sessionsPage(env.DB, userId, { source: 'codex' }, null, 50);
      expect(page.sessions).toHaveLength(1);
      expect(page.sessions[0]!.source).toBe('codex');
    });
  });
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test queries` — EXPECT FAIL (`sessionsPage` missing).
- [ ] Append to `worker/src/queries.ts`:
  ```ts
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
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test queries` — EXPECT PASS (7 tests total).
- [ ] Append to `worker/test/read-api.test.ts`:
  ```ts
  describe('GET /api/sessions', () => {
    it('401s unauthenticated', async () => {
      expect((await SELF.fetch('https://example.com/api/sessions')).status).toBe(401);
    });

    it('returns a first page + nextCursor and a second page', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `sp-${userId}@example.com`);
      for (let i = 0; i < 3; i++) {
        const day = String(10 + i).padStart(2, '0');
        await seedSession(env, { userId, deviceId, sessionId: `q${i}`, totalTokens: i, lastActivity: `2026-06-${day}T00:00:00.000Z` });
      }
      const res = await asViewer(userId, '/api/sessions?limit=2');
      const body = (await res.json()) as { sessions: { sessionId: string }[]; nextCursor: string | null };
      expect(body.sessions).toHaveLength(2);
      expect(body.sessions[0]!.sessionId).toBe('q2');
      expect(body.nextCursor).not.toBeNull();
      const res2 = await asViewer(userId, `/api/sessions?limit=2&cursor=${encodeURIComponent(body.nextCursor!)}`);
      const body2 = (await res2.json()) as { sessions: { sessionId: string }[]; nextCursor: string | null };
      expect(body2.sessions[0]!.sessionId).toBe('q0');
      expect(body2.nextCursor).toBeNull();
    });

    it('isolates users', async () => {
      const { userId } = await seedUser(env);
      const { deviceId } = await seedDevice(env, `sp2-${userId}@example.com`);
      await seedSession(env, { userId, deviceId, sessionId: 'mine', lastActivity: '2026-06-20T00:00:00.000Z' });
      const { userId: other } = await seedUser(env);
      const { deviceId: od } = await seedDevice(env, `sp3-${other}@example.com`);
      await seedSession(env, { userId: other, deviceId: od, sessionId: 'theirs', lastActivity: '2026-07-01T00:00:00.000Z' });
      const res = await asViewer(userId, '/api/sessions');
      const body = (await res.json()) as { sessions: { sessionId: string }[] };
      expect(body.sessions.some((s) => s.sessionId === 'theirs')).toBe(false);
    });
  });
  ```
- [ ] Add the `/api/sessions` route to `worker/src/read_api.ts` (append before nothing else needed; add import + route):
  ```ts
  import { summaryQuery, sessionsPage, clampLimit, type SummaryFilters } from './queries';
  // ... existing summary route above ...

  readApiRoutes.get('/api/sessions', async (c) => {
    const { userId } = c.var.viewer;
    const filters = parseFilters(c);
    const raw = c.req.query();
    const limit = clampLimit(raw.limit ? Number(raw.limit) : undefined);
    const cursor = raw.cursor || null;
    const page = await sessionsPage(c.env.DB, userId, filters, cursor, limit);
    return c.json(page);
  });
  ```
  (Replace the existing `import { summaryQuery, type SummaryFilters } from './queries';` line with the combined import above.)
- [ ] Run `pnpm --filter @ccusage-cloud/worker test read-api` — EXPECT PASS (7 tests total).
- [ ] `git commit -m "feat(worker): GET /api/sessions cursor pagination"`

## Task A5: ASSETS binding + non-API fallthrough

**Files:**
- Modify: `worker/src/env.ts`
- Modify: `worker/wrangler.jsonc`
- Modify: `worker/src/index.ts`
- Test: `worker/test/assets.test.ts` (Create)

**Interfaces:**
- Produces: `Env.ASSETS: Fetcher`; `app.all('*', …)` delegating non-matched paths to `c.env.ASSETS.fetch(c.req.raw)`, registered LAST.
- Decision: `not_found_handling: "single-page-application"` (SPA routing — the dashboard is client-routed; unknown asset paths fall back to `index.html`). API/auth/ingest/health routes are registered before the fallthrough so they win.

Steps:
- [ ] Write the failing test `worker/test/assets.test.ts`. Because `@cloudflare/vitest-pool-workers` does not serve real assets unless an `assets.directory` exists with files, this test asserts the fallthrough delegates by stubbing `env.ASSETS`:
  ```ts
  import { SELF, env } from 'cloudflare:test';
  import { describe, expect, it, vi } from 'vitest';

  describe('ASSETS fallthrough', () => {
    it('delegates unknown non-API paths to the ASSETS binding', async () => {
      const spy = vi.spyOn(env.ASSETS, 'fetch').mockResolvedValue(new Response('STATIC_INDEX', { status: 200 }));
      const res = await SELF.fetch('https://example.com/some/spa/route');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('STATIC_INDEX');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('still routes /health to the worker, not assets', async () => {
      const spy = vi.spyOn(env.ASSETS, 'fetch').mockResolvedValue(new Response('STATIC', { status: 200 }));
      const res = await SELF.fetch('https://example.com/health');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('still 401s /api/* (API wins over assets)', async () => {
      const spy = vi.spyOn(env.ASSETS, 'fetch').mockResolvedValue(new Response('STATIC', { status: 200 }));
      const res = await SELF.fetch('https://example.com/api/me');
      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
  ```
- [ ] Run `pnpm --filter @ccusage-cloud/worker test assets` — EXPECT FAIL (`env.ASSETS` undefined → spyOn throws / fallthrough absent).
- [ ] Modify `worker/src/env.ts` — add `ASSETS: Fetcher;` to `Env`:
  ```ts
  export interface Env {
    DB: D1Database;
    LOGIN_TOKENS: KVNamespace;
    VIEWER_SESSIONS: KVNamespace;
    EMAIL?: EmailSender;
    ASSETS: Fetcher;
  }
  ```
- [ ] Modify `worker/wrangler.jsonc` — add an `assets` block (keep ALL existing keys). Insert after `"send_email"`:
  ```jsonc
    "send_email": [{ "name": "EMAIL" }],
    "assets": {
      "binding": "ASSETS",
      "directory": "../dashboard/dist",
      "not_found_handling": "single-page-application"
    }
  ```
  Note: `../dashboard/dist` is the Astro static build output (Task B1 sets `outDir: 'dist'` — Astro's default). The directory may not exist until the dashboard is built; document that `wrangler dev`/`wrangler deploy` requires a prior `pnpm --filter dashboard build`. The vitest pool does not require the directory to exist (tests stub `env.ASSETS`).
- [ ] Modify `worker/src/index.ts` — add the fallthrough as the LAST registration (after all `app.route(...)` calls, before `export default app`):
  ```ts
  app.route('/', authRoutes);
  app.route('/', apiRoutes);
  app.route('/', readApiRoutes);

  // Non-API paths are served by the static dashboard via the Assets binding.
  // Registered last so /health, /ingest, /auth/*, and /api/* always win.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  export default app;
  ```
- [ ] Ensure the vitest miniflare config provides an ASSETS binding so `env.ASSETS` is defined for `spyOn`. Add to `worker/vitest.config.ts` under `miniflare`: a `serviceBindings` is not suitable; instead rely on wrangler's `assets` block being read by the pool. If `env.ASSETS` is still undefined in tests, add a minimal stub directory: create `worker/test-assets/index.html` with content `<!doctype html><title>ccusage-cloud</title>` and TEMPORARILY... — DO NOT. Instead, verify first: run the test; if `env.ASSETS` is undefined, set `miniflare.bindings` cannot provide a Fetcher. The supported path is: the pool reads `wrangler.jsonc`'s `assets.directory`; create the directory so the binding exists. Create `worker/../dashboard/dist/.gitkeep` is wrong (cross-package). Pragmatic resolution for the test: point a test-only assets dir. Add to `worker/vitest.config.ts`:
  ```ts
  miniflare: {
    d1Databases: ['DB'],
    kvNamespaces: ['LOGIN_TOKENS', 'VIEWER_SESSIONS'],
    bindings: { TEST_MIGRATIONS: migrations },
    assets: { directory: './test/assets-fixture', binding: 'ASSETS' },
  },
  ```
  and create `worker/test/assets-fixture/index.html` containing `<!doctype html><title>ccusage-cloud</title>`. This guarantees `env.ASSETS` is a real Fetcher that `vi.spyOn` can wrap. The real build directory (`../dashboard/dist`) is used at `wrangler dev`/`deploy` time via `wrangler.jsonc`.
- [ ] Run `pnpm --filter @ccusage-cloud/worker test assets` — EXPECT PASS (3 tests).
- [ ] Run the full worker suite `pnpm --filter @ccusage-cloud/worker test` — EXPECT ALL PASS (existing M1/M2 tests + A1–A5).
- [ ] `git commit -m "feat(worker): ASSETS binding + non-API fallthrough for the dashboard"`

---

# Phase B — Dashboard scaffold (new `dashboard/` Astro package)

## Task B1: Scaffold the `dashboard` package

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `dashboard/package.json`, `dashboard/astro.config.mjs`, `dashboard/tsconfig.json`, `dashboard/tailwind.config.ts`, `dashboard/components.json`, `dashboard/.gitignore`, `dashboard/src/styles/global.css`, `dashboard/src/lib/utils.ts`, `dashboard/vitest.config.ts`, `dashboard/vitest.setup.ts`, `dashboard/src/layouts/Base.astro`, `dashboard/src/pages/index.astro`, `dashboard/src/components/Hello.tsx`
- Test: `dashboard/src/components/__tests__/hello.test.tsx` (Create)

**Interfaces:**
- Produces: a buildable Astro static package (`output: 'static'`, default `outDir: dist`), Tailwind 4, shadcn-ready (`cn` util), Vitest+jsdom+Testing-Library wired. `pnpm --filter dashboard build` succeeds; `pnpm --filter dashboard test <name>` runs component tests.

Steps:
- [ ] Modify `pnpm-workspace.yaml` — add `dashboard`:
  ```yaml
  packages:
    - worker
    - cli
    - dashboard
  allowBuilds:
    esbuild: true
    sharp: false
    workerd: true
  ```
- [ ] Create `dashboard/package.json`:
  ```json
  {
    "name": "dashboard",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "astro dev",
      "build": "astro build",
      "preview": "astro preview",
      "test": "vitest run",
      "check": "astro check"
    },
    "dependencies": {
      "astro": "^5.0.0",
      "@astrojs/react": "^4.0.0",
      "react": "^19.0.0",
      "react-dom": "^19.0.0",
      "recharts": "^2.13.0",
      "clsx": "^2.1.0",
      "tailwind-merge": "^2.5.0",
      "class-variance-authority": "^0.7.0",
      "lucide-react": "^0.460.0",
      "@radix-ui/react-switch": "^1.1.0",
      "@radix-ui/react-tabs": "^1.1.0",
      "@radix-ui/react-slot": "^1.1.0"
    },
    "devDependencies": {
      "@tailwindcss/vite": "^4.0.0",
      "tailwindcss": "^4.0.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "typescript": "^5.6.0",
      "vitest": "^2.1.0",
      "jsdom": "^25.0.0",
      "@testing-library/react": "^16.0.0",
      "@testing-library/jest-dom": "^6.5.0",
      "@testing-library/user-event": "^14.5.0"
    }
  }
  ```
- [ ] Create `dashboard/astro.config.mjs`:
  ```js
  import { defineConfig } from 'astro/config';
  import react from '@astrojs/react';
  import tailwindcss from '@tailwindcss/vite';

  export default defineConfig({
    output: 'static',
    integrations: [react()],
    vite: { plugins: [tailwindcss()] },
  });
  ```
- [ ] Create `dashboard/tsconfig.json`:
  ```json
  {
    "extends": "astro/tsconfigs/strict",
    "compilerOptions": {
      "jsx": "react-jsx",
      "jsxImportSource": "react",
      "baseUrl": ".",
      "paths": { "@/*": ["src/*"] }
    },
    "include": ["src", "vitest.setup.ts", "vitest.config.ts"]
  }
  ```
- [ ] Create `dashboard/tailwind.config.ts` (Tailwind 4 uses CSS-first config but keep a minimal file for tooling):
  ```ts
  import type { Config } from 'tailwindcss';
  export default { content: ['./src/**/*.{astro,tsx,ts}'] } satisfies Config;
  ```
- [ ] Create `dashboard/src/styles/global.css`:
  ```css
  @import "tailwindcss";

  :root {
    --background: 0 0% 100%;
    --foreground: 222 47% 11%;
    --muted: 210 40% 96%;
    --border: 214 32% 91%;
  }
  body { @apply bg-white text-slate-900; }
  ```
- [ ] Create `dashboard/components.json` (shadcn config):
  ```json
  {
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "default",
    "rsc": false,
    "tsx": true,
    "tailwind": { "config": "tailwind.config.ts", "css": "src/styles/global.css", "baseColor": "slate", "cssVariables": true },
    "aliases": { "components": "@/components", "utils": "@/lib/utils" }
  }
  ```
- [ ] Create `dashboard/src/lib/utils.ts`:
  ```ts
  import { clsx, type ClassValue } from 'clsx';
  import { twMerge } from 'tailwind-merge';

  export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
  }
  ```
- [ ] Create `dashboard/.gitignore`:
  ```
  dist/
  .astro/
  node_modules/
  ```
- [ ] Create `dashboard/vitest.config.ts`:
  ```ts
  import { defineConfig } from 'vitest/config';
  import react from '@vitejs/plugin-react';

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  });
  ```
  Add `@vitejs/plugin-react` to `dashboard/package.json` devDependencies: `"@vitejs/plugin-react": "^4.3.0"`.
- [ ] Create `dashboard/vitest.setup.ts`:
  ```ts
  import '@testing-library/jest-dom/vitest';
  ```
- [ ] Create `dashboard/src/layouts/Base.astro`:
  ```astro
  ---
  import '../styles/global.css';
  interface Props { title?: string }
  const { title = 'ccusage-cloud' } = Astro.props;
  ---
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
    </head>
    <body>
      <slot />
    </body>
  </html>
  ```
- [ ] Create `dashboard/src/components/Hello.tsx`:
  ```tsx
  export function Hello({ name }: { name: string }) {
    return <p>Hello {name}</p>;
  }
  ```
- [ ] Create `dashboard/src/pages/index.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { Hello } from '../components/Hello';
  ---
  <Base title="ccusage-cloud">
    <main class="p-8">
      <Hello name="cloud" client:load />
    </main>
  </Base>
  ```
- [ ] Write the failing test `dashboard/src/components/__tests__/hello.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react';
  import { describe, expect, it } from 'vitest';
  import { Hello } from '../Hello';

  describe('Hello', () => {
    it('renders the name', () => {
      render(<Hello name="cloud" />);
      expect(screen.getByText('Hello cloud')).toBeInTheDocument();
    });
  });
  ```
- [ ] Install deps: `cd /mnt/dev/ccusage-cloud && pnpm install`.
- [ ] Run `pnpm --filter dashboard test hello` — EXPECT PASS (1 test). (If it fails before implementing, it is because `Hello.tsx` is created in the same task; ensure file exists, then PASS.)
- [ ] Run `pnpm --filter dashboard build` — EXPECT success (Astro emits `dashboard/dist/index.html`). Verify: `test -f dashboard/dist/index.html && echo OK`.
- [ ] `git commit -m "feat(dashboard): scaffold Astro+React+Tailwind+shadcn package with vitest"`

## Task B2: Typed API client (`src/lib/api.ts` + `src/lib/types.ts`)

**Files:**
- Create: `dashboard/src/lib/types.ts`, `dashboard/src/lib/api.ts`
- Test: `dashboard/src/lib/__tests__/api.test.ts` (Create)

**Interfaces:**
- Produces (types must mirror worker `queries.ts` exactly):
  ```ts
  // types.ts
  export interface Me { id: string; email: string; publicToGroup: boolean; devices: DeviceInfo[] }
  export interface DeviceInfo { id: string; label: string; createdAt: number; lastSeenAt: number | null; revokedAt: number | null }
  export interface SummaryTotals { sessions: number; totalTokens: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalCost: number }
  export interface ByDay { day: string; totalTokens: number; totalCost: number }
  export interface BySource { source: string; totalTokens: number; totalCost: number; sessions: number }
  export interface ByModel { model: string; totalTokens: number; totalCost: number }
  export interface ByProject { projectPath: string; totalTokens: number; totalCost: number; sessions: number }
  export interface ByDevice { deviceId: string; label: string; totalTokens: number; totalCost: number; sessions: number }
  export interface Summary { totals: SummaryTotals; byDay: ByDay[]; bySource: BySource[]; byModel: ByModel[]; byProject: ByProject[]; byDevice: ByDevice[] }
  export interface SessionItem { source: string; sessionId: string; deviceId: string; totalTokens: number; totalCost: number; firstActivity: string | null; lastActivity: string | null; modelsUsed: string[]; projectPath: string | null }
  export interface SessionsPage { sessions: SessionItem[]; nextCursor: string | null }
  export interface Filters { from?: string; to?: string; source?: string; device?: string }
  // api.ts functions
  getMe(): Promise<Me>
  patchMe(publicToGroup: boolean): Promise<{ publicToGroup: boolean }>
  createDevice(label: string): Promise<{ id: string; token: string }>
  deleteDevice(id: string): Promise<{ ok: true }>
  getSummary(filters: Filters): Promise<Summary>
  getSessions(filters: Filters, cursor?: string | null): Promise<SessionsPage>
  requestLogin(email: string): Promise<{ ok: true }>
  logout(): Promise<{ ok: true }>
  ```
- Consumes: same-origin `fetch` to `/api/*` and `/auth/*` with `credentials: 'include'`.

Steps:
- [ ] Write the failing test `dashboard/src/lib/__tests__/api.test.ts`:
  ```ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { getMe, getSummary, getSessions, createDevice, deleteDevice, patchMe, requestLogin, logout } from '../api';

  function mockFetch(body: unknown, status = 200) {
    return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  }

  afterEach(() => { vi.restoreAllMocks(); });

  describe('api client', () => {
    it('getMe GETs /api/me with credentials', async () => {
      const f = mockFetch({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] });
      vi.stubGlobal('fetch', f);
      const me = await getMe();
      expect(me.id).toBe('u1');
      expect(f).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'include' }));
    });

    it('getSummary serializes filters into the query string', async () => {
      const f = mockFetch({ totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 }, byDay: [], bySource: [], byModel: [], byProject: [], byDevice: [] });
      vi.stubGlobal('fetch', f);
      await getSummary({ source: 'claude', from: '2026-06-01' });
      const url = f.mock.calls[0][0] as string;
      expect(url).toContain('/api/summary?');
      expect(url).toContain('source=claude');
      expect(url).toContain('from=2026-06-01');
    });

    it('getSessions appends the cursor', async () => {
      const f = mockFetch({ sessions: [], nextCursor: null });
      vi.stubGlobal('fetch', f);
      await getSessions({}, 'CUR');
      expect(f.mock.calls[0][0]).toContain('cursor=CUR');
    });

    it('createDevice POSTs the label', async () => {
      const f = mockFetch({ id: 'dev1', token: 'cccloud_x' });
      vi.stubGlobal('fetch', f);
      const r = await createDevice('laptop');
      expect(r.token).toBe('cccloud_x');
      expect(f).toHaveBeenCalledWith('/api/devices', expect.objectContaining({ method: 'POST' }));
    });

    it('deleteDevice DELETEs by id', async () => {
      const f = mockFetch({ ok: true });
      vi.stubGlobal('fetch', f);
      await deleteDevice('dev1');
      expect(f).toHaveBeenCalledWith('/api/devices/dev1', expect.objectContaining({ method: 'DELETE' }));
    });

    it('patchMe PATCHes publicToGroup', async () => {
      const f = mockFetch({ publicToGroup: true });
      vi.stubGlobal('fetch', f);
      const r = await patchMe(true);
      expect(r.publicToGroup).toBe(true);
    });

    it('requestLogin POSTs to /auth/request', async () => {
      const f = mockFetch({ ok: true });
      vi.stubGlobal('fetch', f);
      await requestLogin('a@b.c');
      expect(f).toHaveBeenCalledWith('/auth/request', expect.objectContaining({ method: 'POST' }));
    });

    it('logout POSTs to /auth/logout', async () => {
      const f = mockFetch({ ok: true });
      vi.stubGlobal('fetch', f);
      await logout();
      expect(f).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({ method: 'POST' }));
    });

    it('throws on non-2xx', async () => {
      vi.stubGlobal('fetch', mockFetch({ error: 'nope' }, 401));
      await expect(getMe()).rejects.toThrow();
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test api` — EXPECT FAIL (`api.ts` missing).
- [ ] Create `dashboard/src/lib/types.ts` with the type block listed in Interfaces above (verbatim).
- [ ] Create `dashboard/src/lib/api.ts`:
  ```ts
  import type { Me, Summary, SessionsPage, Filters } from './types';

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
      throw new Error(`request failed: ${res.status} ${detail}`);
    }
    return (await res.json()) as T;
  }

  function qs(filters: Filters, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `?${s}` : '';
  }

  const base: RequestInit = { credentials: 'include' };
  const jsonHeaders = { 'content-type': 'application/json' };

  export async function getMe(): Promise<Me> {
    return json<Me>(await fetch('/api/me', { ...base }));
  }

  export async function patchMe(publicToGroup: boolean): Promise<{ publicToGroup: boolean }> {
    return json(await fetch('/api/me', { ...base, method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ publicToGroup }) }));
  }

  export async function createDevice(label: string): Promise<{ id: string; token: string }> {
    return json(await fetch('/api/devices', { ...base, method: 'POST', headers: jsonHeaders, body: JSON.stringify({ label }) }));
  }

  export async function deleteDevice(id: string): Promise<{ ok: true }> {
    return json(await fetch(`/api/devices/${id}`, { ...base, method: 'DELETE' }));
  }

  export async function getSummary(filters: Filters): Promise<Summary> {
    return json<Summary>(await fetch(`/api/summary${qs(filters)}`, { ...base }));
  }

  export async function getSessions(filters: Filters, cursor?: string | null): Promise<SessionsPage> {
    const extra: Record<string, string> = {};
    if (cursor) extra.cursor = cursor;
    return json<SessionsPage>(await fetch(`/api/sessions${qs(filters, extra)}`, { ...base }));
  }

  export async function requestLogin(email: string): Promise<{ ok: true }> {
    return json(await fetch('/auth/request', { ...base, method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email }) }));
  }

  export async function logout(): Promise<{ ok: true }> {
    return json(await fetch('/auth/logout', { ...base, method: 'POST' }));
  }
  ```
- [ ] Run `pnpm --filter dashboard test api` — EXPECT PASS (9 tests).
- [ ] `git commit -m "feat(dashboard): typed same-origin API client + shared types"`

## Task B3: App shell + FilterBar island + filter store

**Files:**
- Create: `dashboard/src/lib/filters.ts`, `dashboard/src/components/ui/button.tsx`, `dashboard/src/components/ui/input.tsx`, `dashboard/src/components/ui/card.tsx`, `dashboard/src/components/FilterBar.tsx`, `dashboard/src/components/AppShell.tsx`
- Test: `dashboard/src/components/__tests__/filterbar.test.tsx` (Create)

**Interfaces:**
- Produces:
  ```ts
  // filters.ts
  export interface Filters { from?: string; to?: string; source?: string; device?: string }
  export function readFiltersFromUrl(): Filters
  export function writeFiltersToUrl(f: Filters): void
  // FilterBar.tsx
  export function FilterBar(props: { filters: Filters; sources: string[]; devices: { id: string; label: string }[]; onChange: (f: Filters) => void }): JSX.Element
  // AppShell.tsx
  export function AppShell(props: { active: string; children: React.ReactNode }): JSX.Element
  ```
- Consumes: `Filters` type (re-export from `./types`).

Steps:
- [ ] Create `dashboard/src/components/ui/button.tsx`:
  ```tsx
  import * as React from 'react';
  import { Slot } from '@radix-ui/react-slot';
  import { cva, type VariantProps } from 'class-variance-authority';
  import { cn } from '@/lib/utils';

  const buttonVariants = cva(
    'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
    {
      variants: {
        variant: {
          default: 'bg-slate-900 text-white hover:bg-slate-700',
          outline: 'border border-slate-300 bg-white hover:bg-slate-100',
          ghost: 'hover:bg-slate-100',
        },
        size: { default: 'h-9 px-4 py-2', sm: 'h-8 px-3', icon: 'h-9 w-9' },
      },
      defaultVariants: { variant: 'default', size: 'default' },
    },
  );

  export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    asChild?: boolean;
  }

  export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
      const Comp = asChild ? Slot : 'button';
      return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
    },
  );
  Button.displayName = 'Button';
  ```
- [ ] Create `dashboard/src/components/ui/input.tsx`:
  ```tsx
  import * as React from 'react';
  import { cn } from '@/lib/utils';

  export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
      <input ref={ref} className={cn('flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm', className)} {...props} />
    ),
  );
  Input.displayName = 'Input';
  ```
- [ ] Create `dashboard/src/components/ui/card.tsx`:
  ```tsx
  import * as React from 'react';
  import { cn } from '@/lib/utils';

  export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)} {...props} />;
  }
  export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('p-4 border-b border-slate-100', className)} {...props} />;
  }
  export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    return <h3 className={cn('text-sm font-semibold text-slate-700', className)} {...props} />;
  }
  export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('p-4', className)} {...props} />;
  }
  ```
- [ ] Create `dashboard/src/lib/filters.ts`:
  ```ts
  export type { Filters } from './types';
  import type { Filters } from './types';

  export function readFiltersFromUrl(): Filters {
    if (typeof window === 'undefined') return {};
    const p = new URLSearchParams(window.location.search);
    const f: Filters = {};
    for (const k of ['from', 'to', 'source', 'device'] as const) {
      const v = p.get(k);
      if (v) f[k] = v;
    }
    return f;
  }

  export function writeFiltersToUrl(f: Filters): void {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    for (const k of ['from', 'to', 'source', 'device'] as const) {
      const v = f[k];
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }
  ```
- [ ] Create `dashboard/src/components/FilterBar.tsx`:
  ```tsx
  import { Input } from '@/components/ui/input';
  import { Button } from '@/components/ui/button';
  import type { Filters } from '@/lib/types';

  export function FilterBar({
    filters,
    sources,
    devices,
    onChange,
  }: {
    filters: Filters;
    sources: string[];
    devices: { id: string; label: string }[];
    onChange: (f: Filters) => void;
  }) {
    function set<K extends keyof Filters>(key: K, value: string) {
      onChange({ ...filters, [key]: value || undefined });
    }
    return (
      <div className="flex flex-wrap items-end gap-3" data-testid="filter-bar">
        <label className="text-xs text-slate-500">
          From
          <Input type="date" aria-label="from" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">
          To
          <Input type="date" aria-label="to" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">
          Source
          <select
            aria-label="source"
            className="flex h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            value={filters.source ?? ''}
            onChange={(e) => set('source', e.target.value)}
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Device
          <select
            aria-label="device"
            className="flex h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            value={filters.device ?? ''}
            onChange={(e) => set('device', e.target.value)}
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={() => onChange({})}>Clear</Button>
      </div>
    );
  }
  ```
- [ ] Create `dashboard/src/components/AppShell.tsx`:
  ```tsx
  import type { ReactNode } from 'react';

  const NAV = [
    { href: '/overview', label: 'Overview' },
    { href: '/sources', label: 'Sources & Models' },
    { href: '/projects', label: 'Projects' },
    { href: '/devices', label: 'Devices' },
    { href: '/sessions', label: 'Sessions' },
    { href: '/settings', label: 'Settings' },
  ];

  export function AppShell({ active, children }: { active: string; children: ReactNode }) {
    return (
      <div className="min-h-screen">
        <header className="border-b border-slate-200">
          <nav className="flex gap-4 px-6 py-3 text-sm" aria-label="primary">
            <span className="font-semibold">ccusage-cloud</span>
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={n.href === active ? 'font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-900'}
              >
                {n.label}
              </a>
            ))}
          </nav>
        </header>
        <main className="p-6">{children}</main>
      </div>
    );
  }
  ```
- [ ] Write the failing test `dashboard/src/components/__tests__/filterbar.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { describe, expect, it, vi } from 'vitest';
  import { FilterBar } from '../FilterBar';

  describe('FilterBar', () => {
    it('renders source and device options', () => {
      render(<FilterBar filters={{}} sources={['claude', 'codex']} devices={[{ id: 'd1', label: 'laptop' }]} onChange={() => {}} />);
      expect(screen.getByRole('option', { name: 'claude' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'laptop' })).toBeInTheDocument();
    });

    it('emits a filter change when a source is picked', async () => {
      const onChange = vi.fn();
      render(<FilterBar filters={{}} sources={['claude', 'codex']} devices={[]} onChange={onChange} />);
      await userEvent.selectOptions(screen.getByLabelText('source'), 'codex');
      expect(onChange).toHaveBeenCalledWith({ source: 'codex' });
    });

    it('clears all filters', async () => {
      const onChange = vi.fn();
      render(<FilterBar filters={{ source: 'claude' }} sources={['claude']} devices={[]} onChange={onChange} />);
      await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(onChange).toHaveBeenCalledWith({});
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test filterbar` — EXPECT FAIL then implement (files above) → run again EXPECT PASS (3 tests).
- [ ] `git commit -m "feat(dashboard): app shell, FilterBar island, filter url store, shadcn primitives"`

---

# Phase C — Views (one task per view)

> Convention for every C task: the React island fetches via `@/lib/api`, reads/writes filters via `@/lib/filters`, renders inside `AppShell`, and ships with an `.astro` page that hydrates it `client:load`. Component tests mock `fetch` via `vi.stubGlobal`. Recharts renders inside a fixed-size container in tests (set explicit `width`/`height` so jsdom can lay it out; tests assert on data/labels, not pixel geometry).

## Task C1: Login gate

**Files:**
- Create: `dashboard/src/components/LoginGate.tsx`, `dashboard/src/pages/login.astro`
- Test: `dashboard/src/components/__tests__/logingate.test.tsx` (Create)

**Interfaces:**
- Produces: `LoginGate()` — calls `getMe()`; if it resolves → redirects to `/overview` (or renders children); if it rejects (401) → shows email form that POSTs `requestLogin(email)` then shows "Check your inbox."

Steps:
- [ ] Write failing test `dashboard/src/components/__tests__/logingate.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { LoginGate } from '../LoginGate';

  afterEach(() => vi.restoreAllMocks());

  describe('LoginGate', () => {
    it('shows the email form when not authenticated', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
      render(<LoginGate />);
      await waitFor(() => expect(screen.getByLabelText('email')).toBeInTheDocument());
    });

    it('submits the email and confirms', async () => {
      const f = vi.fn()
        .mockResolvedValueOnce(new Response('{}', { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal('fetch', f);
      render(<LoginGate />);
      await waitFor(() => screen.getByLabelText('email'));
      await userEvent.type(screen.getByLabelText('email'), 'a@b.c');
      await userEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeInTheDocument());
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test logingate` — EXPECT FAIL.
- [ ] Create `dashboard/src/components/LoginGate.tsx`:
  ```tsx
  import { useEffect, useState } from 'react';
  import { getMe, requestLogin } from '@/lib/api';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

  type State = 'checking' | 'anon' | 'sent';

  export function LoginGate() {
    const [state, setState] = useState<State>('checking');
    const [email, setEmail] = useState('');

    useEffect(() => {
      getMe()
        .then(() => {
          if (typeof window !== 'undefined') window.location.href = '/overview';
        })
        .catch(() => setState('anon'));
    }, []);

    async function submit(e: React.FormEvent) {
      e.preventDefault();
      try { await requestLogin(email); } catch { /* never reveal */ }
      setState('sent');
    }

    if (state === 'checking') return <p className="p-8 text-slate-500">Loading…</p>;
    if (state === 'sent') {
      return (
        <div className="mx-auto mt-24 max-w-sm">
          <Card>
            <CardHeader><CardTitle>Check your inbox</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-slate-600">If your email is invited, a magic link is on its way.</p></CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="mx-auto mt-24 max-w-sm">
        <Card>
          <CardHeader><CardTitle>Sign in to ccusage-cloud</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <Input aria-label="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <Button type="submit">Send magic link</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }
  ```
- [ ] Create `dashboard/src/pages/login.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { LoginGate } from '../components/LoginGate';
  ---
  <Base title="Sign in — ccusage-cloud">
    <LoginGate client:load />
  </Base>
  ```
- [ ] Also create `dashboard/src/pages/index.astro` redirect-or-gate: replace the B1 placeholder `index.astro` so the root hosts the login gate:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { LoginGate } from '../components/LoginGate';
  ---
  <Base title="ccusage-cloud">
    <LoginGate client:load />
  </Base>
  ```
  (Delete `dashboard/src/components/Hello.tsx` and its test `dashboard/src/components/__tests__/hello.test.tsx` now that the real index exists. Verify the build still passes.)
- [ ] Run `pnpm --filter dashboard test logingate` — EXPECT PASS (2 tests). Run `pnpm --filter dashboard build` — EXPECT success.
- [ ] `git commit -m "feat(dashboard): login gate view (email -> magic link)"`

## Task C2: Overview island

**Files:**
- Create: `dashboard/src/components/Overview.tsx`, `dashboard/src/pages/overview.astro`
- Test: `dashboard/src/components/__tests__/overview.test.tsx` (Create)

**Interfaces:**
- Produces: `Overview()` — reads filters from URL, calls `getMe()` (for FilterBar source/device options) + `getSummary(filters)`, renders headline totals (sessions, totalTokens, totalCost) and a Recharts line/area time-series over `byDay` (tokens + cost). FilterBar `onChange` updates URL + refetches.

Steps:
- [ ] Write failing test `dashboard/src/components/__tests__/overview.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { Overview } from '../Overview';

  afterEach(() => vi.restoreAllMocks());

  function routeFetch(map: Record<string, unknown>) {
    return vi.fn().mockImplementation((url: string) => {
      const key = Object.keys(map).find((k) => url.startsWith(k));
      const body = key ? map[key] : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
  }

  describe('Overview', () => {
    it('renders headline totals from the summary', async () => {
      vi.stubGlobal('fetch', routeFetch({
        '/api/me': { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] },
        '/api/summary': {
          totals: { sessions: 3, totalTokens: 465, inputTokens: 310, outputTokens: 155, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 3.5 },
          byDay: [{ day: '2026-06-20', totalTokens: 150, totalCost: 1 }, { day: '2026-06-21', totalTokens: 315, totalCost: 2.5 }],
          bySource: [], byModel: [], byProject: [], byDevice: [],
        },
      }));
      render(<Overview />);
      await waitFor(() => expect(screen.getByText('465')).toBeInTheDocument());
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText(/\$3\.50/)).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test overview` — EXPECT FAIL.
- [ ] Create `dashboard/src/components/Overview.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react';
  import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
  import { getMe, getSummary } from '@/lib/api';
  import type { Summary, Me } from '@/lib/types';
  import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
  import { FilterBar } from '@/components/FilterBar';
  import { AppShell } from '@/components/AppShell';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

  function Stat({ label, value }: { label: string; value: string }) {
    return (
      <Card>
        <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold">{value}</p></CardContent>
      </Card>
    );
  }

  export function Overview() {
    const [filters, setFilters] = useState<Filters>({});
    const [me, setMe] = useState<Me | null>(null);
    const [summary, setSummary] = useState<Summary | null>(null);

    useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
    useEffect(() => { getSummary(filters).then(setSummary).catch(() => setSummary(null)); }, [filters]);

    const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

    const sources = summary?.bySource.map((s) => s.source) ?? [];
    const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];

    return (
      <AppShell active="/overview">
        <div className="space-y-6">
          <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Sessions" value={String(summary?.totals.sessions ?? 0)} />
            <Stat label="Total tokens" value={String(summary?.totals.totalTokens ?? 0)} />
            <Stat label="Total cost" value={`$${(summary?.totals.totalCost ?? 0).toFixed(2)}`} />
          </div>
          <Card>
            <CardHeader><CardTitle>Tokens &amp; cost over time</CardTitle></CardHeader>
            <CardContent>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={summary?.byDay ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Line yAxisId="left" type="monotone" dataKey="totalTokens" stroke="#0f172a" dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="totalCost" stroke="#2563eb" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  ```
- [ ] Create `dashboard/src/pages/overview.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { Overview } from '../components/Overview';
  ---
  <Base title="Overview — ccusage-cloud">
    <Overview client:load />
  </Base>
  ```
- [ ] Run `pnpm --filter dashboard test overview` — EXPECT PASS (1 test). (If Recharts ResponsiveContainer warns about zero dimensions in jsdom, the fixed `height: 320` + `width: '100%'` plus the test asserting on text — not chart pixels — keeps it green.)
- [ ] `git commit -m "feat(dashboard): Overview island with totals and time-series"`

## Task C3: By source + By model

**Files:**
- Create: `dashboard/src/components/BySourceModel.tsx`, `dashboard/src/pages/sources.astro`
- Test: `dashboard/src/components/__tests__/bysourcemodel.test.tsx` (Create)

**Interfaces:**
- Produces: `BySourceModel()` — Recharts bar charts for `bySource` (cost+tokens) and `byModel` (cost+tokens), driven by the same FilterBar.

Steps:
- [ ] Write failing test `dashboard/src/components/__tests__/bysourcemodel.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { BySourceModel } from '../BySourceModel';

  afterEach(() => vi.restoreAllMocks());

  describe('BySourceModel', () => {
    it('lists sources and models from the summary', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        const body = url.startsWith('/api/me')
          ? { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }
          : {
              totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
              byDay: [],
              bySource: [{ source: 'claude', totalTokens: 450, totalCost: 3, sessions: 2 }, { source: 'codex', totalTokens: 15, totalCost: 0.5, sessions: 1 }],
              byModel: [{ model: 'claude-opus-4', totalTokens: 150, totalCost: 1 }],
              byProject: [], byDevice: [],
            };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }));
      render(<BySourceModel />);
      await waitFor(() => expect(screen.getByText('claude')).toBeInTheDocument());
      expect(screen.getByText('codex')).toBeInTheDocument();
      expect(screen.getByText('claude-opus-4')).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test bysourcemodel` — EXPECT FAIL.
- [ ] Create `dashboard/src/components/BySourceModel.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react';
  import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
  import { getMe, getSummary } from '@/lib/api';
  import type { Summary, Me } from '@/lib/types';
  import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
  import { FilterBar } from '@/components/FilterBar';
  import { AppShell } from '@/components/AppShell';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

  export function BySourceModel() {
    const [filters, setFilters] = useState<Filters>({});
    const [me, setMe] = useState<Me | null>(null);
    const [summary, setSummary] = useState<Summary | null>(null);

    useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
    useEffect(() => { getSummary(filters).then(setSummary).catch(() => setSummary(null)); }, [filters]);
    const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

    const sources = summary?.bySource.map((s) => s.source) ?? [];
    const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];

    return (
      <AppShell active="/sources">
        <div className="space-y-6">
          <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          <Card>
            <CardHeader><CardTitle>By source</CardTitle></CardHeader>
            <CardContent>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary?.bySource ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="source" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="totalCost" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 text-sm text-slate-600">
                {(summary?.bySource ?? []).map((s) => (
                  <li key={s.source}>{s.source}: {s.totalTokens} tokens, ${s.totalCost.toFixed(2)}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>By model</CardTitle></CardHeader>
            <CardContent>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary?.byModel ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="model" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="totalCost" fill="#0f172a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 text-sm text-slate-600">
                {(summary?.byModel ?? []).map((m) => (
                  <li key={m.model}>{m.model}: {m.totalTokens} tokens, ${m.totalCost.toFixed(2)}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  ```
- [ ] Create `dashboard/src/pages/sources.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { BySourceModel } from '../components/BySourceModel';
  ---
  <Base title="Sources & Models — ccusage-cloud">
    <BySourceModel client:load />
  </Base>
  ```
- [ ] Run `pnpm --filter dashboard test bysourcemodel` — EXPECT PASS (1 test).
- [ ] `git commit -m "feat(dashboard): By source + By model breakdowns"`

## Task C4: By project

**Files:**
- Create: `dashboard/src/components/ByProject.tsx`, `dashboard/src/pages/projects.astro`
- Test: `dashboard/src/components/__tests__/byproject.test.tsx` (Create)

**Interfaces:**
- Produces: `ByProject()` — top projects by cost as a table (projectPath, tokens, cost, sessions), `scope=me`, driven by FilterBar.

Steps:
- [ ] Write failing test `dashboard/src/components/__tests__/byproject.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { ByProject } from '../ByProject';

  afterEach(() => vi.restoreAllMocks());

  describe('ByProject', () => {
    it('renders the project rows sorted by cost', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        const body = url.startsWith('/api/me')
          ? { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }
          : {
              totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
              byDay: [], bySource: [], byModel: [],
              byProject: [{ projectPath: '/work/app', totalTokens: 450, totalCost: 3, sessions: 2 }, { projectPath: '(unknown)', totalTokens: 7, totalCost: 0.1, sessions: 1 }],
              byDevice: [],
            };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }));
      render(<ByProject />);
      await waitFor(() => expect(screen.getByText('/work/app')).toBeInTheDocument());
      expect(screen.getByText('(unknown)')).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test byproject` — EXPECT FAIL.
- [ ] Create `dashboard/src/components/ByProject.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react';
  import { getMe, getSummary } from '@/lib/api';
  import type { Summary, Me } from '@/lib/types';
  import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
  import { FilterBar } from '@/components/FilterBar';
  import { AppShell } from '@/components/AppShell';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

  export function ByProject() {
    const [filters, setFilters] = useState<Filters>({});
    const [me, setMe] = useState<Me | null>(null);
    const [summary, setSummary] = useState<Summary | null>(null);

    useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
    useEffect(() => { getSummary(filters).then(setSummary).catch(() => setSummary(null)); }, [filters]);
    const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

    const sources = summary?.bySource.map((s) => s.source) ?? [];
    const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
    const rows = [...(summary?.byProject ?? [])].sort((a, b) => b.totalCost - a.totalCost);

    return (
      <AppShell active="/projects">
        <div className="space-y-6">
          <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          <Card>
            <CardHeader><CardTitle>Top projects by cost</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Project</th><th>Tokens</th><th>Cost</th><th>Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.projectPath} className="border-t border-slate-100">
                      <td className="py-1 font-mono">{p.projectPath}</td>
                      <td>{p.totalTokens}</td>
                      <td>${p.totalCost.toFixed(2)}</td>
                      <td>{p.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  ```
- [ ] Create `dashboard/src/pages/projects.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { ByProject } from '../components/ByProject';
  ---
  <Base title="Projects — ccusage-cloud">
    <ByProject client:load />
  </Base>
  ```
- [ ] Run `pnpm --filter dashboard test byproject` — EXPECT PASS (1 test).
- [ ] `git commit -m "feat(dashboard): By project table"`

## Task C5: By device

**Files:**
- Create: `dashboard/src/components/ByDevice.tsx`, `dashboard/src/pages/devices.astro`
- Test: `dashboard/src/components/__tests__/bydevice.test.tsx` (Create)

**Interfaces:**
- Produces: `ByDevice()` — Recharts pie of device contribution by cost + a legend list (label, tokens, cost, sessions). Note: this page is the analytics "By device" contribution; device management (add/revoke) lives in C7 Settings/Devices. The nav `/devices` points here; settings/devices management is `/settings`.

Steps:
- [ ] Write failing test `dashboard/src/components/__tests__/bydevice.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { ByDevice } from '../ByDevice';

  afterEach(() => vi.restoreAllMocks());

  describe('ByDevice', () => {
    it('renders the device contribution legend', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        const body = url.startsWith('/api/me')
          ? { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }
          : {
              totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
              byDay: [], bySource: [], byModel: [], byProject: [],
              byDevice: [{ deviceId: 'd1', label: 'laptop', totalTokens: 450, totalCost: 3, sessions: 2 }, { deviceId: 'd2', label: 'desktop', totalTokens: 15, totalCost: 0.5, sessions: 1 }],
            };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }));
      render(<ByDevice />);
      await waitFor(() => expect(screen.getByText(/laptop/)).toBeInTheDocument());
      expect(screen.getByText(/desktop/)).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test bydevice` — EXPECT FAIL.
- [ ] Create `dashboard/src/components/ByDevice.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react';
  import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
  import { getMe, getSummary } from '@/lib/api';
  import type { Summary, Me } from '@/lib/types';
  import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
  import { FilterBar } from '@/components/FilterBar';
  import { AppShell } from '@/components/AppShell';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

  const COLORS = ['#0f172a', '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ca8a04'];

  export function ByDevice() {
    const [filters, setFilters] = useState<Filters>({});
    const [me, setMe] = useState<Me | null>(null);
    const [summary, setSummary] = useState<Summary | null>(null);

    useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
    useEffect(() => { getSummary(filters).then(setSummary).catch(() => setSummary(null)); }, [filters]);
    const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

    const sources = summary?.bySource.map((s) => s.source) ?? [];
    const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
    const data = summary?.byDevice ?? [];

    return (
      <AppShell active="/devices">
        <div className="space-y-6">
          <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          <Card>
            <CardHeader><CardTitle>Device contribution (by cost)</CardTitle></CardHeader>
            <CardContent>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data} dataKey="totalCost" nameKey="label" outerRadius={120}>
                      {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 text-sm text-slate-600">
                {data.map((d) => (
                  <li key={d.deviceId}>{d.label}: {d.totalTokens} tokens, ${d.totalCost.toFixed(2)}, {d.sessions} sessions</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  ```
- [ ] Create `dashboard/src/pages/devices.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { ByDevice } from '../components/ByDevice';
  ---
  <Base title="Devices — ccusage-cloud">
    <ByDevice client:load />
  </Base>
  ```
- [ ] Run `pnpm --filter dashboard test bydevice` — EXPECT PASS (1 test).
- [ ] `git commit -m "feat(dashboard): By device contribution view"`

## Task C6: Sessions table (paginated)

**Files:**
- Create: `dashboard/src/components/ui/table.tsx`, `dashboard/src/components/SessionsTable.tsx`, `dashboard/src/pages/sessions.astro`
- Test: `dashboard/src/components/__tests__/sessionstable.test.tsx` (Create)

**Interfaces:**
- Produces: `SessionsTable()` — shadcn table of sessions from `getSessions(filters)`, "Load more" appends the next page via `nextCursor`; client-side sort by column header (lastActivity / totalTokens / totalCost). Driven by FilterBar.

Steps:
- [ ] Create `dashboard/src/components/ui/table.tsx`:
  ```tsx
  import * as React from 'react';
  import { cn } from '@/lib/utils';

  export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
    return <table className={cn('w-full text-sm', className)} {...props} />;
  }
  export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) { return <thead {...props} />; }
  export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} />; }
  export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
    return <tr className={cn('border-t border-slate-100', className)} {...props} />;
  }
  export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
    return <th className={cn('py-1 text-left font-medium text-slate-500', className)} {...props} />;
  }
  export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
    return <td className={cn('py-1', className)} {...props} />;
  }
  ```
- [ ] Write failing test `dashboard/src/components/__tests__/sessionstable.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { SessionsTable } from '../SessionsTable';

  afterEach(() => vi.restoreAllMocks());

  describe('SessionsTable', () => {
    it('renders the first page and loads more via the cursor', async () => {
      const f = vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('/api/me')) {
          return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
        }
        if (url.includes('cursor=CUR')) {
          return Promise.resolve(new Response(JSON.stringify({
            sessions: [{ source: 'claude', sessionId: 's2', deviceId: 'd1', totalTokens: 200, totalCost: 2, firstActivity: null, lastActivity: '2026-06-20T00:00:00.000Z', modelsUsed: [], projectPath: '/p' }],
            nextCursor: null,
          }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          sessions: [{ source: 'claude', sessionId: 's1', deviceId: 'd1', totalTokens: 100, totalCost: 1, firstActivity: null, lastActivity: '2026-06-21T00:00:00.000Z', modelsUsed: [], projectPath: '/p' }],
          nextCursor: 'CUR',
        }), { status: 200 }));
      });
      vi.stubGlobal('fetch', f);
      render(<SessionsTable />);
      await waitFor(() => expect(screen.getByText('s1')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: /load more/i }));
      await waitFor(() => expect(screen.getByText('s2')).toBeInTheDocument());
      expect(screen.getByText('s1')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test sessionstable` — EXPECT FAIL.
- [ ] Create `dashboard/src/components/SessionsTable.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react';
  import { getMe, getSessions } from '@/lib/api';
  import type { Me, SessionItem } from '@/lib/types';
  import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
  import { FilterBar } from '@/components/FilterBar';
  import { AppShell } from '@/components/AppShell';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

  type SortKey = 'lastActivity' | 'totalTokens' | 'totalCost';

  export function SessionsTable() {
    const [filters, setFilters] = useState<Filters>({});
    const [me, setMe] = useState<Me | null>(null);
    const [rows, setRows] = useState<SessionItem[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [sort, setSort] = useState<SortKey>('lastActivity');
    const [loading, setLoading] = useState(false);

    useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);

    const loadFirst = useCallback((f: Filters) => {
      setLoading(true);
      getSessions(f)
        .then((page) => { setRows(page.sessions); setCursor(page.nextCursor); })
        .catch(() => { setRows([]); setCursor(null); })
        .finally(() => setLoading(false));
    }, []);

    useEffect(() => { loadFirst(filters); }, [filters, loadFirst]);

    const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

    function loadMore() {
      if (!cursor) return;
      setLoading(true);
      getSessions(filters, cursor)
        .then((page) => { setRows((prev) => [...prev, ...page.sessions]); setCursor(page.nextCursor); })
        .catch(() => { /* keep current */ })
        .finally(() => setLoading(false));
    }

    const sorted = [...rows].sort((a, b) => {
      if (sort === 'lastActivity') return String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''));
      return (b[sort] as number) - (a[sort] as number);
    });

    const sources = me ? [] : [];
    const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];

    return (
      <AppShell active="/sessions">
        <div className="space-y-6">
          <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          <Card>
            <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>Source</TH>
                    <TH>Session</TH>
                    <TH><button onClick={() => setSort('lastActivity')}>Last activity</button></TH>
                    <TH><button onClick={() => setSort('totalTokens')}>Tokens</button></TH>
                    <TH><button onClick={() => setSort('totalCost')}>Cost</button></TH>
                    <TH>Project</TH>
                  </TR>
                </THead>
                <TBody>
                  {sorted.map((s) => (
                    <TR key={`${s.source}:${s.sessionId}`}>
                      <TD>{s.source}</TD>
                      <TD className="font-mono">{s.sessionId}</TD>
                      <TD>{s.lastActivity ?? '—'}</TD>
                      <TD>{s.totalTokens}</TD>
                      <TD>${s.totalCost.toFixed(2)}</TD>
                      <TD className="font-mono">{s.projectPath ?? '(unknown)'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {cursor && (
                <div className="mt-4">
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>Load more</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  ```
- [ ] Create `dashboard/src/pages/sessions.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { SessionsTable } from '../components/SessionsTable';
  ---
  <Base title="Sessions — ccusage-cloud">
    <SessionsTable client:load />
  </Base>
  ```
- [ ] Run `pnpm --filter dashboard test sessionstable` — EXPECT PASS (1 test).
- [ ] `git commit -m "feat(dashboard): paginated Sessions table with load-more"`

## Task C7: Settings + Devices management

**Files:**
- Create: `dashboard/src/components/ui/switch.tsx`, `dashboard/src/components/SettingsDevices.tsx`, `dashboard/src/pages/settings.astro`
- Test: `dashboard/src/components/__tests__/settingsdevices.test.tsx` (Create)

**Interfaces:**
- Produces: `SettingsDevices()` — group-sharing `Switch` wired to `patchMe`; device list with add (label → `createDevice`, token shown once) and revoke (`deleteDevice`). Refetches `getMe()` after mutations.

Steps:
- [ ] Create `dashboard/src/components/ui/switch.tsx`:
  ```tsx
  import * as React from 'react';
  import * as SwitchPrimitive from '@radix-ui/react-switch';
  import { cn } from '@/lib/utils';

  export const Switch = React.forwardRef<
    React.ElementRef<typeof SwitchPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
  >(({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn('inline-flex h-5 w-9 items-center rounded-full bg-slate-300 data-[state=checked]:bg-slate-900', className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  ));
  Switch.displayName = 'Switch';
  ```
- [ ] Write failing test `dashboard/src/components/__tests__/settingsdevices.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { SettingsDevices } from '../SettingsDevices';

  afterEach(() => vi.restoreAllMocks());

  const me = { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] };

  describe('SettingsDevices', () => {
    it('lists devices and toggles group sharing', async () => {
      const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.startsWith('/api/me') && init?.method === 'PATCH') {
          return Promise.resolve(new Response(JSON.stringify({ publicToGroup: true }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
      });
      vi.stubGlobal('fetch', f);
      render(<SettingsDevices />);
      await waitFor(() => expect(screen.getByText('laptop')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('switch'));
      await waitFor(() => expect(f).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' })));
    });

    it('adds a device and shows the token once', async () => {
      const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === '/api/devices' && init?.method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({ id: 'd2', token: 'cccloud_secret' }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
      });
      vi.stubGlobal('fetch', f);
      render(<SettingsDevices />);
      await waitFor(() => screen.getByText('laptop'));
      await userEvent.type(screen.getByLabelText('new device label'), 'phone');
      await userEvent.click(screen.getByRole('button', { name: /add device/i }));
      await waitFor(() => expect(screen.getByText('cccloud_secret')).toBeInTheDocument());
    });
  });
  ```
- [ ] Run `pnpm --filter dashboard test settingsdevices` — EXPECT FAIL.
- [ ] Create `dashboard/src/components/SettingsDevices.tsx`:
  ```tsx
  import { useEffect, useState } from 'react';
  import { getMe, patchMe, createDevice, deleteDevice, logout } from '@/lib/api';
  import type { Me } from '@/lib/types';
  import { AppShell } from '@/components/AppShell';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Switch } from '@/components/ui/switch';

  export function SettingsDevices() {
    const [me, setMe] = useState<Me | null>(null);
    const [label, setLabel] = useState('');
    const [newToken, setNewToken] = useState<string | null>(null);

    function refresh() { getMe().then(setMe).catch(() => setMe(null)); }
    useEffect(() => { refresh(); }, []);

    async function toggle(next: boolean) {
      await patchMe(next);
      refresh();
    }

    async function add() {
      if (!label.trim()) return;
      const { token } = await createDevice(label.trim());
      setNewToken(token);
      setLabel('');
      refresh();
    }

    async function revoke(id: string) {
      await deleteDevice(id);
      refresh();
    }

    return (
      <AppShell active="/settings">
        <div className="space-y-6 max-w-2xl">
          <Card>
            <CardHeader><CardTitle>Group sharing</CardTitle></CardHeader>
            <CardContent>
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={me?.publicToGroup ?? false} onCheckedChange={(v) => toggle(Boolean(v))} />
                Share my usage with the group
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Devices</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm">
                {(me?.devices ?? []).map((d) => (
                  <li key={d.id} className="flex items-center justify-between">
                    <span>{d.label}{d.revokedAt ? ' (revoked)' : ''}</span>
                    {!d.revokedAt && <Button size="sm" variant="outline" onClick={() => revoke(d.id)}>Revoke</Button>}
                  </li>
                ))}
              </ul>
              <div className="flex items-end gap-2">
                <label className="text-xs text-slate-500">
                  New device
                  <Input aria-label="new device label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop" />
                </label>
                <Button size="sm" onClick={add}>Add device</Button>
              </div>
              {newToken && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium">Copy this token now — it is shown only once:</p>
                  <code className="break-all">{newToken}</code>
                </div>
              )}
            </CardContent>
          </Card>

          <Button variant="ghost" onClick={() => logout().then(() => { window.location.href = '/'; })}>Log out</Button>
        </div>
      </AppShell>
    );
  }
  ```
- [ ] Create `dashboard/src/pages/settings.astro`:
  ```astro
  ---
  import Base from '../layouts/Base.astro';
  import { SettingsDevices } from '../components/SettingsDevices';
  ---
  <Base title="Settings — ccusage-cloud">
    <SettingsDevices client:load />
  </Base>
  ```
- [ ] Run `pnpm --filter dashboard test settingsdevices` — EXPECT PASS (2 tests).
- [ ] Run `pnpm --filter dashboard test` (whole suite) — EXPECT ALL PASS. Run `pnpm --filter dashboard build` — EXPECT success (all pages emit).
- [ ] `git commit -m "feat(dashboard): Settings group toggle + device management"`

---

# Phase D — Integration test

## Task D1: Login→Overview smoke e2e (guarded)

**Files:**
- Create: `dashboard/e2e/login-overview.test.ts`
- Modify: `dashboard/vitest.config.ts` (exclude `e2e/**` from the default unit run; add an `e2e` test project/script)
- Modify: `dashboard/package.json` (add `"test:e2e"` script)

**Interfaces:**
- Produces: a single smoke test that renders the built dashboard's Overview flow against a mocked API, asserting that an authenticated viewer reaches Overview headline totals. Guarded to skip cleanly when the environment cannot run it (mirrors M2's e2e guarding via `describe.skipIf`).

**Decision (lightest approach that verifies the path):** Use the existing jsdom + Testing-Library stack with a routed `fetch` mock to drive `LoginGate` → authenticated → `Overview`. This exercises the real client components and the api client end-to-end without a browser/Playwright dependency. The guard skips when `process.env.CI_SKIP_E2E === '1'` or when `typeof document === 'undefined'`.

Steps:
- [ ] Modify `dashboard/vitest.config.ts` to exclude e2e from the unit `include` (already `src/**` only) and add a second test script. Confirm `include: ['src/**/*.test.{ts,tsx}']` already excludes `e2e/`. Add `"test:e2e": "vitest run e2e"` to `dashboard/package.json` scripts.
- [ ] Write `dashboard/e2e/login-overview.test.ts`:
  ```ts
  import { render, screen, waitFor } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { Overview } from '../src/components/Overview';
  import { LoginGate } from '../src/components/LoginGate';

  const canRun = typeof document !== 'undefined' && process.env.CI_SKIP_E2E !== '1';

  afterEach(() => vi.restoreAllMocks());

  describe.skipIf(!canRun)('e2e: login -> overview', () => {
    it('an authenticated viewer is sent to overview and sees totals', async () => {
      // Authenticated getMe resolves -> LoginGate redirects (we assert it does NOT show the email form).
      const okMe = { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] };
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify(okMe), { status: 200 }));
        if (url.startsWith('/api/summary')) {
          return Promise.resolve(new Response(JSON.stringify({
            totals: { sessions: 7, totalTokens: 1000, inputTokens: 700, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 9.99 },
            byDay: [{ day: '2026-06-21', totalTokens: 1000, totalCost: 9.99 }],
            bySource: [], byModel: [], byProject: [], byDevice: [],
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }));

      // LoginGate with an authenticated session must not render the email form.
      const gate = render(<LoginGate />);
      await waitFor(() => expect(gate.queryByLabelText('email')).not.toBeInTheDocument());
      gate.unmount();

      // Overview renders the totals for the authenticated viewer.
      render(<Overview />);
      await waitFor(() => expect(screen.getByText('1000')).toBeInTheDocument());
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText(/\$9\.99/)).toBeInTheDocument();
    });
  });
  ```
  (Note: `LoginGate` sets `window.location.href` on success; in jsdom this is a no-op write that does not throw — the assertion only checks the email form is absent, which is true while authenticated.)
- [ ] Run `pnpm --filter dashboard test:e2e` — EXPECT PASS (1 test) in a jsdom-capable env; EXPECT SKIPPED when `CI_SKIP_E2E=1`. Verify skip: `CI_SKIP_E2E=1 pnpm --filter dashboard test:e2e` shows the test skipped, exit 0.
- [ ] `git commit -m "test(dashboard): guarded login->overview smoke e2e"`

---

## Self-Review

### Spec-coverage table

| M3 spec item | Task(s) |
| --- | --- |
| A1 read API: `/api/summary` aggregation | A2 (`summaryQuery`), A3 (endpoint) |
| A2 read API: `/api/sessions` cursor pagination | A4 |
| A3 read API: ASSETS binding / same-origin serving | A5 |
| Test helper `seedSession` | A1 |
| B4 dashboard scaffold (Astro+React+Tailwind+shadcn+Recharts) | B1 |
| B5 typed API client + shared types | B2 |
| B6 app shell + FilterBar | B3 |
| B7 views — Login | C1 |
| B7 views — Overview (tokens & cost over time) | C2 |
| B7 views — By source + By model | C3 |
| B7 views — By project | C4 |
| B7 views — By device | C5 |
| B7 views — Sessions table (paginated) | C6 |
| B7 views — Settings + Devices | C7 |
| C8 testing — worker aggregation + cross-user isolation (2 devices) | A2, A3, A4 |
| C8 testing — dashboard component tests (table + filters + Overview) | B3, C2, C6 |
| C9 testing — one smoke e2e (guarded) | D1 |

### Type-consistency check (queries.ts ↔ read_api.ts ↔ dashboard api.ts/types.ts)

- `Summary`/`SummaryTotals`/`ByDay`/`BySource`/`ByModel`/`ByProject`/`ByDevice`: defined in `worker/src/queries.ts` (A2) and mirrored field-for-field in `dashboard/src/lib/types.ts` (B2). Key names are camelCase on both sides; the worker SQL aliases (`AS totalTokens`, `AS projectPath`, `AS deviceId`, etc.) produce exactly those JSON keys. `read_api.ts` passes the `summaryQuery` result straight to `c.json(...)`, so no shape divergence.
- `SessionsPage`/`SessionRow` (worker) ↔ `SessionsPage`/`SessionItem` (dashboard): identical fields (`source, sessionId, deviceId, totalTokens, totalCost, firstActivity, lastActivity, modelsUsed, projectPath` + `nextCursor`). `read_api.ts` returns `sessionsPage(...)` verbatim.
- `Me`/`DeviceInfo` (dashboard) mirror the existing `/api/me` response from `worker/src/api.ts` (`id, email, publicToGroup, devices[{ id, label, createdAt, lastSeenAt, revokedAt }]`) — unchanged by M3.
- `Filters` (dashboard `lib/filters.ts` re-export of `types.ts`) ↔ `SummaryFilters` (worker): same optional `from, to, source, device`. The api client serializes them to the same query-param names the worker valibot schema reads.

### byModel aggregation decision (recorded)

byModel is computed in SQL via `json_each(sessions.model_breakdowns)` joined per row, extracting `$.modelName` for the name, summing the four token fields (`inputTokens+outputTokens+cacheCreationTokens+cacheReadTokens`) for `totalTokens`, and `$.cost` for `totalCost`, with `COALESCE(...,0)` on every numeric and `json_valid` guarding malformed rows. The exact key names (`modelName`, `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `cost`) are **VERIFIED against live ccusage output (2026-06-24, `bunx ccusage claude session --json` → `.sessions[0].modelBreakdowns[0]`)** — the paths are final and need no further verification. Fallback: rows with NULL/invalid/keyless breakdowns contribute nothing to byModel; the seed helper writes valid breakdowns so the tested path is the primary one.

### Assets `not_found_handling` decision (recorded)

`not_found_handling: "single-page-application"` — the dashboard is a multi-page Astro static build but client-routed islands rely on SPA-style fallback for deep links; unknown asset paths serve `index.html` so refreshes on `/overview`, `/sessions`, etc. resolve. API/auth/ingest/health routes are registered in the Hono app BEFORE the `app.all('*', ...)` ASSETS fallthrough, so they always win over assets.

### Placeholder scan

No `TODO`, `FIXME`, "similar to Task N", or stubbed function bodies remain. Every code step contains complete, runnable code. Every file path is absolute-from-repo-root and exact. Every task ends with a `git commit`. Test commands and expected pass/skip counts are stated per task.

## Open questions

1. **`model_breakdowns` key names** — RESOLVED. Verified against live `bunx ccusage claude session --json`: each `modelBreakdowns[]` element is `{ modelName, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cost }` (no per-model `totalTokens`; sum the four). The A2 `$.modelName`/`$.cost`/token json paths are pinned and final. No action needed.
2. **vitest-pool-workers ASSETS binding in tests** — A5 adds a `test/assets-fixture/` dir + `miniflare.assets` config so `env.ASSETS` is a real Fetcher for `vi.spyOn`. If the installed `@cloudflare/vitest-pool-workers` version does not accept `miniflare.assets`, fall back to asserting the fallthrough via a unit test of `index.ts`'s route registration order; flagged for the implementer.
3. **Dependency versions** (Astro 5, Tailwind 4, React 19, Recharts 2) are pinned to current majors; `pnpm install` in B1 may resolve newer patch/minor — if a breaking peer conflict appears, pin exact versions. Tailwind 4 is CSS-first (`@import "tailwindcss"`); if the toolchain in the dev shell expects Tailwind 3 PostCSS config, downgrade to `tailwindcss@^3` + `@astrojs/tailwind` and adjust B1.
4. **Astro `client:load` hydration in component tests** — tests render the React islands directly (not through Astro), so hydration is not exercised by unit tests; the D1 smoke test also renders components directly. A true browser hydration check is out of scope per the spec's "one smoke e2e" and is deliberately not added.

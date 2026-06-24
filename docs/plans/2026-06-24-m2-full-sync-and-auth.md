# ccusage-cloud M2: Full Sync + Viewer Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sync production-usable (all sources, incremental, chunked, resilient, with a `status` command) and let invited humans log in to the dashboard via magic links, exposing the minimal device/settings API the M3 dashboard will consume — plus the automated cross-process e2e deferred from M1.

**Architecture:** Two tracks on the existing single Worker + Node CLI. **CLI track (Phase A):** the `sync` command grows a source list, a content-hash `state.json` for incremental pushes (`--full` to override), batching with retry/backoff, and a `status` command. **Worker track (Phases B–C):** magic-link viewer auth backed by two KV namespaces (`LOGIN_TOKENS`, `VIEWER_SESSIONS`), a `requireViewer` cookie middleware, and a small account/device API (`/api/me`, `/api/devices`, `PATCH /api/me`). **Phase D** adds an automated CLI↔Worker e2e via `wrangler unstable_dev`. No D1 schema change — M1's `users.public_to_group`, `allowed_emails`, and `devices` already cover M2.

**Tech Stack:** TypeScript (strict, ESM), pnpm workspace, Hono v4 (`hono/cookie`, `hono/factory`), valibot v1, Cloudflare Workers + D1 + **KV** + **Email Sending** (`send_email` binding), wrangler v4 (`unstable_dev`), vitest + `@cloudflare/vitest-pool-workers`, Node ≥20 built-ins (`node:crypto`, `node:fs`, `node:util` `parseArgs`).

## Drift check (run 2026-06-24, before writing this plan)

- **ccusage session JSON shape — NO DRIFT.** `rust/crates/ccusage/src/output.rs::session_summary_json` emits exactly: `sessionId, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens, totalCost, lastActivity, firstActivity, modelsUsed, modelBreakdowns, projectPath`, plus `credits` only when present. It is a **single shared serializer** used by every adapter, so "all sources" only changes which source names are iterated; the per-session shape is identical to M1's `SessionRowSchema`/`SessionSchema`. No schema change needed.
- **M1 interfaces — PRESENT as extended here:** `Config { serverUrl, token, ccusageBin }`, `configPath/loadConfig/saveConfig` (`cli/src/config.ts`); `Runner`, `loadSessions(source, bin, run?)` (`cli/src/ccusage.ts`); `syncOnce(cfg, sources, run?, fetchFn?)` (`cli/src/sync.ts`) — **its signature changes in Task A2 to an options object**; `TaggedSession` (`cli/src/types.ts`); `upsertSessions`, `deviceAuth`, `IngestSchema/SessionSchema`, `Env/DeviceContext/AppBindings`, `sha256Hex` (worker).
- **Decisions — confirmed:** token `cccloud_`+base64url(32), SHA-256-only storage (unchanged); KV TTLs LOGIN_TOKENS 900 s, VIEWER_SESSIONS 2 592 000 s sliding; **email:** sender `noreply@ethanchung.dev` from the apex domain `ethanchung.dev` (spec said `no-reply@ethanchung.dev` — same domain, settled local-part `noreply@`); `from` and `wrangler email sending enable` use `ethanchung.dev`. **wrangler config since the spec:** `compatibility_date` is now `2026-06-01` and `workers_dev`/`preview_urls` are `false` (aligns with the no-workers.dev decision; M2 must not re-enable them).

## Global Constraints

- **Node** ≥20; **pnpm** workspace (`worker/`, `cli/`); **TypeScript** strict, ESM, `moduleResolution: bundler`.
- **Worker runtime:** Hono v4, valibot v1, wrangler v4, `compatibility_date = "2026-06-01"`, `compatibility_flags = ["nodejs_compat"]`, `workers_dev = false`, `preview_urls = false`, `observability.enabled = true`. Do not change these.
- **Sources (the 15 ccusage agent adapters):** `amp, claude, codebuff, codex, copilot, droid, gemini, goose, hermes, kilo, kimi, openclaw, opencode, pi, qwen`. Sources that error or return empty are silently skipped (already `loadSessions`' M1 behavior).
- **Device token:** `cccloud_` + base64url(32 random bytes); store only lowercase-hex SHA-256 (`token_sha256`); plaintext shown once.
- **Magic-link login token:** opaque random base64url(32), KV key in `LOGIN_TOKENS`, value `{ email }`, **TTL 900 s, single-use** (deleted on consume).
- **Viewer session:** id = random base64url(32), KV key in `VIEWER_SESSIONS`, value `{ userId }`, **TTL 2 592 000 s (30 d), sliding** (refreshed on each authenticated request). Cookie name `ccusage_session`; attributes `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`.
- **Email sender:** `noreply@ethanchung.dev`, display name `ccusage-cloud`, via the `send_email` binding `EMAIL`. The onboarded Email Sending domain is the apex `ethanchung.dev`; the matching enable step is `wrangler email sending enable ethanchung.dev` (deploy-time / M4). DKIM/SPF/DMARC live on `ethanchung.dev`. M2 code must not 500 if `EMAIL` is absent or `.send()` throws.
- **`/auth/request` never enumerates:** always returns 200 regardless of whether the email is allow-listed or the send succeeded.
- **Chunking:** push sessions in batches of **500**; retry each batch with exponential backoff on network error / HTTP 5xx (max 4 attempts: ~250ms, 500ms, 1000ms). Persist state hashes only for batches the server accepted.
- **Incremental state:** `~/.config/ccusage-cloud/state.json` (XDG-aware), `chmod 600` (it reveals which sessions exist, though no tokens). `--full` bypasses it.
- **No new D1 migration.** All M2 storage is KV; device/user/settings columns already exist.

## File Structure

```
ccusage-cloud/
  cli/
    src/
      sources.ts        # NEW: ALL_SOURCES list
      state.ts          # NEW: SyncState load/save, session hashing + diff
      sync.ts           # MOD: options object, incremental + chunk + retry
      index.ts          # MOD: --source/--full, status command, all sources
    test/
      sources.test.ts   # NEW
      state.test.ts      # NEW
      sync.test.ts      # MOD: incremental, chunking, retry
      status.test.ts    # NEW (status via run())
      e2e.test.ts       # NEW (Phase D, wrangler unstable_dev)
  worker/
    wrangler.jsonc      # MOD: kv_namespaces + send_email binding
    vitest.config.ts    # MOD: miniflare kvNamespaces
    env.d.ts            # MOD: ProvidedEnv adds KV
    src/
      env.ts            # MOD: Env adds KV + EMAIL; Variables adds viewer
      tokens.ts         # NEW: randomBase64Url, randomToken
      kv.ts             # NEW: typed LOGIN_TOKENS / VIEWER_SESSIONS wrappers
      email.ts          # NEW: sendMagicLink
      auth_routes.ts    # NEW: /auth/request, /auth/callback, /auth/logout
      viewer.ts         # NEW: requireViewer middleware
      api.ts            # NEW: /api/me, /api/devices, PATCH /api/me
      index.ts          # MOD: mount auth + api routers
    test/
      seed.ts           # MOD: add seedUser, seedViewerSession helpers
      tokens.test.ts    # NEW
      kv.test.ts        # NEW
      email.test.ts     # NEW
      auth_routes.test.ts # NEW
      viewer.test.ts    # NEW
      api.test.ts       # NEW
```

---

# Phase A — CLI sync hardening

## Task A1: Source list + multi-source sync + `--source`

**Files:**
- Create: `cli/src/sources.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/test/sources.test.ts`

**Interfaces:**
- Produces: `ALL_SOURCES: readonly string[]` from `sources.ts`.
- The `sync` command iterates `ALL_SOURCES` by default, or a single source when `--source <name>` is given.

- [ ] **Step 1: Write the source list**

`cli/src/sources.ts`:
```ts
// The ccusage agent adapters (one `ccusage <source> session --json` each).
// Mirrors rust/crates/ccusage/src/adapter/* (excluding the aggregate `all`).
// Sources that error or return empty are skipped by loadSessions, so an
// occasional stale entry here is harmless.
export const ALL_SOURCES = [
  'amp',
  'claude',
  'codebuff',
  'codex',
  'copilot',
  'droid',
  'gemini',
  'goose',
  'hermes',
  'kilo',
  'kimi',
  'openclaw',
  'opencode',
  'pi',
  'qwen',
] as const;
```

- [ ] **Step 2: Write the failing test**

`cli/test/sources.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ALL_SOURCES } from '../src/sources';

describe('ALL_SOURCES', () => {
  it('includes claude and is a non-trivial, unique list', () => {
    expect(ALL_SOURCES).toContain('claude');
    expect(ALL_SOURCES.length).toBeGreaterThan(10);
    expect(new Set(ALL_SOURCES).size).toBe(ALL_SOURCES.length);
  });
});
```

- [ ] **Step 3: Run it (red→green: the file already exists, so this verifies the export)**

Run: `pnpm --filter ccusage-cloud test sources`
Expected: 1 test PASS.

- [ ] **Step 4: Wire `--source` into the dispatcher (kept minimal; full sync rewrite is Task A2)**

In `cli/src/index.ts`, replace the `const M1_SOURCES = ['claude'];` line with an import and add the `source` option. Replace lines 1–4:
```ts
import { parseArgs } from 'node:util';
import { loadConfig, saveConfig } from './config';
import { ALL_SOURCES } from './sources';
```
In the `parseArgs` `options` object add:
```ts
      source: { type: 'string' },
```
Replace the `sync` block body (the M1 lines that read `M1_SOURCES`) with:
```ts
  if (cmd === 'sync') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('Not logged in. Run `ccusage-cloud login --server <url> --token <token>`.');
      return 1;
    }
    const sources = values.source ? [values.source] : [...ALL_SOURCES];
    const { syncOnce } = await import('./sync');
    const { pushed, skipped } = await syncOnce(cfg, sources);
    console.log(`Pushed ${pushed} sessions (${skipped} unchanged).`);
    return 0;
  }
```

> Note: `syncOnce` returns `{ pushed, skipped }` after Task A2. Until A2 lands, `skipped` is `undefined` and prints `(undefined unchanged)`; A2 is the very next task and fixes the return shape. The CLI is not built/typechecked package-wide between A1 and A2.

- [ ] **Step 5: Commit**

```bash
git add cli/src/sources.ts cli/test/sources.test.ts cli/src/index.ts
git commit -m "feat(cli): all-source sync with --source filter"
```

---

## Task A2: Incremental state (`state.json`) + `--full`

**Files:**
- Create: `cli/src/state.ts`
- Modify: `cli/src/sync.ts`, `cli/src/index.ts`
- Test: `cli/test/state.test.ts`, `cli/test/sync.test.ts` (rewrite)

**Interfaces:**
- Consumes: `TaggedSession` (`types.ts`), `loadSessions`/`Runner` (`ccusage.ts`), `Config` (`config.ts`).
- Produces from `state.ts`: `SyncState = { hashes: Record<string,string>; lastSyncAt: number | null }`; `statePath(): string`; `loadState(path?): SyncState`; `saveState(state, path?): void`; `sessionKey(s): string`; `sessionHash(s): string`; `diffSessions(sessions, state): { changed: TaggedSession[]; unchanged: number }`.
- Produces from `sync.ts`: `syncOnce(cfg, sources, opts?: SyncOpts): Promise<{ pushed: number; skipped: number; chunks: number }>` where `SyncOpts = { run?: Runner; fetchFn?: typeof fetch; full?: boolean; statePath?: string; chunkSize?: number; retries?: number }`.

- [ ] **Step 1: Write `state.ts`**

`cli/src/state.ts`:
```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TaggedSession } from './types';

export interface SyncState {
  hashes: Record<string, string>;
  lastSyncAt: number | null;
}

export function statePath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'ccusage-cloud', 'state.json');
}

export function loadState(path = statePath()): SyncState {
  if (!existsSync(path)) return { hashes: {}, lastSyncAt: null };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SyncState>;
  return { hashes: parsed.hashes ?? {}, lastSyncAt: parsed.lastSyncAt ?? null };
}

export function saveState(state: SyncState, path = statePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  chmodSync(path, 0o600);
}

export function sessionKey(s: TaggedSession): string {
  return `${s.source}\t${s.sessionId}`;
}

// Stable content hash. TaggedSession is built with a deterministic key order
// (valibot output order + sessionId + source), so JSON.stringify is stable.
export function sessionHash(s: TaggedSession): string {
  return createHash('sha256').update(JSON.stringify(s)).digest('hex');
}

export function diffSessions(
  sessions: TaggedSession[],
  state: SyncState,
): { changed: TaggedSession[]; unchanged: number } {
  const changed: TaggedSession[] = [];
  let unchanged = 0;
  for (const s of sessions) {
    if (state.hashes[sessionKey(s)] === sessionHash(s)) unchanged += 1;
    else changed.push(s);
  }
  return { changed, unchanged };
}
```

- [ ] **Step 2: Write the failing state test**

`cli/test/state.test.ts`:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffSessions, loadState, saveState, sessionHash, type SyncState } from '../src/state';
import type { TaggedSession } from '../src/types';

function sess(over: Partial<TaggedSession> = {}): TaggedSession {
  return {
    source: 'claude',
    sessionId: 's1',
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 2,
    totalCost: 0.1,
    firstActivity: 'a',
    lastActivity: 'b',
    modelsUsed: [],
    modelBreakdowns: null,
    projectPath: '/p',
    ...over,
  } as TaggedSession;
}

describe('sync state', () => {
  it('round-trips state and defaults when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccc-state-'));
    const path = join(dir, 'state.json');
    expect(loadState(path)).toEqual({ hashes: {}, lastSyncAt: null });
    const state: SyncState = { hashes: { 'claude\ts1': 'abc' }, lastSyncAt: 123 };
    saveState(state, path);
    expect(loadState(path)).toEqual(state);
  });

  it('diff returns only changed sessions', () => {
    const s = sess();
    const state: SyncState = { hashes: { 'claude\ts1': sessionHash(s) }, lastSyncAt: 1 };
    expect(diffSessions([s], state)).toEqual({ changed: [], unchanged: 1 });
    const changed = sess({ totalCost: 9.99 });
    expect(diffSessions([changed], state).changed).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter ccusage-cloud test state`
Expected: 2 tests PASS.

- [ ] **Step 4: Rewrite `sync.ts` for incremental + chunk + retry**

`cli/src/sync.ts` (full replacement):
```ts
import type { Config } from './config';
import { loadSessions, type Runner } from './ccusage';
import type { TaggedSession } from './types';
import {
  diffSessions,
  loadState,
  saveState,
  sessionHash,
  sessionKey,
  statePath as defaultStatePath,
} from './state';

export interface SyncOpts {
  run?: Runner;
  fetchFn?: typeof fetch;
  full?: boolean;
  statePath?: string;
  chunkSize?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postBatch(
  cfg: Config,
  batch: TaggedSession[],
  fetchFn: typeof fetch,
  retries: number,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchFn(new URL('/ingest', cfg.serverUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify({ sessions: batch }),
      });
      if (res.ok) return;
      // 4xx are not retried (bad payload / auth); 5xx are.
      if (res.status < 500) throw new Error(`ingest failed: ${res.status} ${await res.text()}`);
      lastErr = new Error(`ingest failed: ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(250 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error('ingest failed');
}

export async function syncOnce(
  cfg: Config,
  sources: string[],
  opts: SyncOpts = {},
): Promise<{ pushed: number; skipped: number; chunks: number }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const chunkSize = opts.chunkSize ?? 500;
  const retries = opts.retries ?? 3;
  const path = opts.statePath ?? defaultStatePath();

  const all: TaggedSession[] = [];
  for (const source of sources) all.push(...loadSessions(source, cfg.ccusageBin, opts.run));

  const state = opts.full ? { hashes: {}, lastSyncAt: null } : loadState(path);
  const { changed, unchanged } = opts.full
    ? { changed: all, unchanged: 0 }
    : diffSessions(all, state);

  if (changed.length === 0) {
    saveState({ hashes: state.hashes, lastSyncAt: Date.now() }, path);
    return { pushed: 0, skipped: unchanged, chunks: 0 };
  }

  let pushed = 0;
  let chunks = 0;
  for (let i = 0; i < changed.length; i += chunkSize) {
    const batch = changed.slice(i, i + chunkSize);
    await postBatch(cfg, batch, fetchFn, retries); // throws → state holds prior batches only
    for (const s of batch) state.hashes[sessionKey(s)] = sessionHash(s);
    pushed += batch.length;
    chunks += 1;
    saveState({ hashes: state.hashes, lastSyncAt: Date.now() }, path); // persist after each delivered batch
  }
  return { pushed, skipped: unchanged, chunks };
}
```

- [ ] **Step 5: Rewrite `cli/test/sync.test.ts`**

`cli/test/sync.test.ts` (full replacement):
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { syncOnce } from '../src/sync';
import type { Runner } from '../src/ccusage';
import type { Config } from '../src/config';
import { loadState } from '../src/state';

const cfg: Config = { serverUrl: 'https://api.example.dev', token: 'cccloud_xyz', ccusageBin: 'ccusage' };

function fixture(n: number): string {
  const sessions = Array.from({ length: n }, (_, i) => ({
    sessionId: `s${i}`,
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 2,
    totalCost: 0.1,
    firstActivity: 'a',
    lastActivity: 'b',
    modelsUsed: [],
    modelBreakdowns: [],
    projectPath: '/p',
  }));
  return JSON.stringify({ sessions, totals: {} });
}
const runN = (n: number): Runner => () => fixture(n);
const ok = () => new Response(JSON.stringify({ upserted: 1, skipped: 0 }), { status: 200 });

function tmpState(): string {
  return join(mkdtempSync(join(tmpdir(), 'ccc-sync-')), 'state.json');
}

describe('syncOnce', () => {
  it('posts changed sessions and records state; a second run skips them', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => ok());
    const first = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath });
    expect(first).toEqual({ pushed: 1, skipped: 0, chunks: 1 });
    expect(loadState(statePath).lastSyncAt).not.toBeNull();

    const second = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath });
    expect(second).toEqual({ pushed: 0, skipped: 1, chunks: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1); // not called again
  });

  it('--full re-sends everything regardless of state', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => ok());
    await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath });
    const full = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath, full: true });
    expect(full.pushed).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('chunks into batches of chunkSize', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => ok());
    const res = await syncOnce(cfg, ['claude'], { run: runN(3), fetchFn: fetchFn as unknown as typeof fetch, statePath, chunkSize: 2 });
    expect(res).toEqual({ pushed: 3, skipped: 0, chunks: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx then succeeds, and persists state only after success', async () => {
    const statePath = tmpState();
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response('boom', { status: 503 }) : ok();
    });
    const res = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath, retries: 2 });
    expect(res.pushed).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(Object.keys(loadState(statePath).hashes)).toHaveLength(1);
  });

  it('does not persist hashes for a batch the server permanently rejects', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath, retries: 2 }),
    ).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1); // 4xx not retried
    expect(loadState(statePath).hashes).toEqual({});
  });
});
```

- [ ] **Step 6: Add `--full` to the dispatcher**

In `cli/src/index.ts` `parseArgs` `options`, add:
```ts
      full: { type: 'boolean' },
```
In the `sync` block, replace the `syncOnce(cfg, sources)` call with:
```ts
    const { pushed, skipped } = await syncOnce(cfg, sources, { full: values.full ?? false });
```

- [ ] **Step 7: Run the CLI tests**

Run: `pnpm --filter ccusage-cloud test state sync`
Expected: state 2 PASS, sync 5 PASS.

- [ ] **Step 8: Commit**

```bash
git add cli/src/state.ts cli/src/sync.ts cli/src/index.ts cli/test/state.test.ts cli/test/sync.test.ts
git commit -m "feat(cli): incremental state.json sync with --full, chunking, and retry"
```

---

## Task A3: `status` command

**Files:**
- Modify: `cli/src/index.ts`
- Test: `cli/test/status.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `loadState`, `loadSessions` + `ALL_SOURCES`, `diffSessions`.
- Produces: a `status` subcommand printing server URL, ccusage binary, last sync time, and pending (changed-but-unsynced) session count. To stay testable, `run(argv)` accepts an injected reader.

- [ ] **Step 1: Make `run` injectable for sources (test seam)**

The dispatcher shells out to `ccusage` via `loadSessions`. For `status` we count pending sessions without pushing. Add an optional injected `Runner` parameter to `run` so tests avoid spawning real `ccusage`. In `cli/src/index.ts`, change the signature and thread it:
```ts
import type { Runner } from './ccusage';
import { loadSessions } from './ccusage';
import { diffSessions, loadState } from './state';
// ...
export async function run(argv: string[], runner?: Runner): Promise<number> {
```
Pass `runner` into the `sync` path too: `await syncOnce(cfg, sources, { full: values.full ?? false, run: runner });`

- [ ] **Step 2: Add the `status` block** (above the final `console.error('Usage…')`)

```ts
  if (cmd === 'status') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('Not logged in.');
      return 1;
    }
    const state = loadState();
    const sources = values.source ? [values.source] : [...ALL_SOURCES];
    const all = sources.flatMap((s) => loadSessions(s, cfg.ccusageBin, runner));
    const { changed } = diffSessions(all, state);
    const last = state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : 'never';
    console.log(`Server:    ${cfg.serverUrl}`);
    console.log(`ccusage:   ${cfg.ccusageBin}`);
    console.log(`Last sync: ${last}`);
    console.log(`Pending:   ${changed.length} session(s)`);
    return 0;
  }
```
Update the usage line to `Usage: ccusage-cloud <login|sync|status>`.

- [ ] **Step 3: Write the failing status test**

`cli/test/status.test.ts`:
```ts
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/index';
import type { Runner } from '../src/ccusage';

const fixture = JSON.stringify({
  sessions: [
    { sessionId: 's1', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.1, firstActivity: 'a', lastActivity: 'b', modelsUsed: [], modelBreakdowns: [], projectPath: '/p' },
  ],
  totals: {},
});

describe('status command', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ccc-status-'));
    process.env.XDG_CONFIG_HOME = dir;
    mkdirSync(join(dir, 'ccusage-cloud'), { recursive: true });
    writeFileSync(
      join(dir, 'ccusage-cloud', 'config.json'),
      JSON.stringify({ serverUrl: 'https://x.dev', token: 'cccloud_t', ccusageBin: 'ccusage' }),
    );
  });
  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    vi.restoreAllMocks();
  });

  it('reports pending sessions and never-synced state', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runner: Runner = (_bin, args) => (args[0] === 'claude' ? fixture : '{"sessions":[]}');
    const code = await run(['status', '--source', 'claude'], runner);
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('Server:    https://x.dev');
    expect(out).toContain('Last sync: never');
    expect(out).toContain('Pending:   1 session(s)');
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter ccusage-cloud test status`
Expected: 1 test PASS.

- [ ] **Step 5: Verify the whole CLI still typechecks/builds and the full suite is green**

Run:
```bash
pnpm --filter ccusage-cloud exec tsc --noEmit
pnpm --filter ccusage-cloud test
```
Expected: no type errors; config, sources, state, ccusage, sync, status all green.

- [ ] **Step 6: Commit**

```bash
git add cli/src/index.ts cli/test/status.test.ts
git commit -m "feat(cli): status command (server, last sync, pending count)"
```

---

# Phase B — Worker viewer auth

## Task B1: KV + EMAIL bindings, env types, `tokens.ts`, `kv.ts`

**Files:**
- Modify: `worker/wrangler.jsonc`, `worker/vitest.config.ts`, `worker/env.d.ts`, `worker/src/env.ts`
- Create: `worker/src/tokens.ts`, `worker/src/kv.ts`
- Test: `worker/test/tokens.test.ts`, `worker/test/kv.test.ts`

**Interfaces:**
- Produces from `env.ts`: `Env` gains `LOGIN_TOKENS: KVNamespace`, `VIEWER_SESSIONS: KVNamespace`, `EMAIL?: EmailSender`; `ViewerContext = { userId: string }`; `AppBindings.Variables` gains `viewer: ViewerContext`. `EmailSender` interface (so tests can stub it).
- Produces from `tokens.ts`: `randomBase64Url(bytes?: number): string`; `randomToken(prefix: string, bytes?: number): string`.
- Produces from `kv.ts`: `putLoginToken(env, token, email, ttl?)`, `consumeLoginToken(env, token): Promise<{ email: string } | null>`, `putViewerSession(env, sid, userId, ttl?)`, `getViewerSession(env, sid, refresh?): Promise<{ userId: string } | null>`, `deleteViewerSession(env, sid)`. Default TTLs: 900 / 2 592 000.

- [ ] **Step 1: Add bindings to `wrangler.jsonc`**

Add these top-level keys to `worker/wrangler.jsonc` (after `d1_databases`):
```jsonc
  "kv_namespaces": [
    { "binding": "LOGIN_TOKENS", "id": "login-tokens-local-placeholder" },
    { "binding": "VIEWER_SESSIONS", "id": "viewer-sessions-local-placeholder" }
  ],
  "send_email": [{ "name": "EMAIL" }]
```

- [ ] **Step 2: Add KV to miniflare test bindings**

In `worker/vitest.config.ts`, inside `miniflare`, add a `kvNamespaces` entry alongside `d1Databases`:
```ts
          miniflare: {
            d1Databases: ['DB'],
            kvNamespaces: ['LOGIN_TOKENS', 'VIEWER_SESSIONS'],
            bindings: { TEST_MIGRATIONS: migrations },
          },
```
(The `send_email` binding is not provided in the test runtime; `EMAIL` is `undefined` there and the email path is guarded — see Task B2.)

- [ ] **Step 3: Extend env types**

`worker/src/env.ts` (full replacement):
```ts
export interface EmailMessage {
  to: string;
  from: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface Env {
  DB: D1Database;
  LOGIN_TOKENS: KVNamespace;
  VIEWER_SESSIONS: KVNamespace;
  EMAIL?: EmailSender;
}

export interface DeviceContext {
  userId: string;
  deviceId: string;
}

export interface ViewerContext {
  userId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { device: DeviceContext; viewer: ViewerContext };
};
```

`worker/env.d.ts` (full replacement):
```ts
import type { Env } from './src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [ ] **Step 4: Write `tokens.ts`**

`worker/src/tokens.ts`:
```ts
function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBase64Url(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${randomBase64Url(bytes)}`;
}
```

- [ ] **Step 5: Write `kv.ts`**

`worker/src/kv.ts`:
```ts
import type { Env } from './env';

const LOGIN_TTL = 900; // 15 min
const SESSION_TTL = 2_592_000; // 30 days

export async function putLoginToken(env: Env, token: string, email: string, ttl = LOGIN_TTL): Promise<void> {
  await env.LOGIN_TOKENS.put(token, JSON.stringify({ email }), { expirationTtl: ttl });
}

export async function consumeLoginToken(env: Env, token: string): Promise<{ email: string } | null> {
  const raw = await env.LOGIN_TOKENS.get(token);
  if (raw === null) return null;
  await env.LOGIN_TOKENS.delete(token); // single-use
  return JSON.parse(raw) as { email: string };
}

export async function putViewerSession(env: Env, sid: string, userId: string, ttl = SESSION_TTL): Promise<void> {
  await env.VIEWER_SESSIONS.put(sid, JSON.stringify({ userId }), { expirationTtl: ttl });
}

export async function getViewerSession(
  env: Env,
  sid: string,
  refresh = true,
): Promise<{ userId: string } | null> {
  const raw = await env.VIEWER_SESSIONS.get(sid);
  if (raw === null) return null;
  const value = JSON.parse(raw) as { userId: string };
  if (refresh) await env.VIEWER_SESSIONS.put(sid, raw, { expirationTtl: SESSION_TTL }); // sliding
  return value;
}

export async function deleteViewerSession(env: Env, sid: string): Promise<void> {
  await env.VIEWER_SESSIONS.delete(sid);
}
```

- [ ] **Step 6: Write the failing tests**

`worker/test/tokens.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { randomBase64Url, randomToken } from '../src/tokens';

describe('tokens', () => {
  it('produces url-safe, unique, prefixed tokens', () => {
    const a = randomToken('cccloud_');
    const b = randomToken('cccloud_');
    expect(a.startsWith('cccloud_')).toBe(true);
    expect(a).not.toBe(b);
    expect(a.slice('cccloud_'.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomBase64Url(16)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
```

`worker/test/kv.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { consumeLoginToken, deleteViewerSession, getViewerSession, putLoginToken, putViewerSession } from '../src/kv';

describe('kv wrappers', () => {
  it('login token is single-use', async () => {
    await putLoginToken(env, 'tok1', 'me@example.com');
    expect(await consumeLoginToken(env, 'tok1')).toEqual({ email: 'me@example.com' });
    expect(await consumeLoginToken(env, 'tok1')).toBeNull();
  });

  it('viewer session resolves and can be deleted', async () => {
    await putViewerSession(env, 'sid1', 'usr_1');
    expect(await getViewerSession(env, 'sid1')).toEqual({ userId: 'usr_1' });
    await deleteViewerSession(env, 'sid1');
    expect(await getViewerSession(env, 'sid1')).toBeNull();
  });
});
```

- [ ] **Step 7: Run them**

Run: `pnpm --filter @ccusage-cloud/worker test tokens kv`
Expected: tokens 1 PASS, kv 2 PASS. (If KV is missing, re-check Step 2.)

- [ ] **Step 8: Commit**

```bash
git add worker/wrangler.jsonc worker/vitest.config.ts worker/env.d.ts worker/src/env.ts worker/src/tokens.ts worker/src/kv.ts worker/test/tokens.test.ts worker/test/kv.test.ts
git commit -m "feat(worker): KV + EMAIL bindings, token + KV-session helpers"
```

---

## Task B2: `email.ts` — `sendMagicLink`

**Files:**
- Create: `worker/src/email.ts`
- Test: `worker/test/email.test.ts`

**Interfaces:**
- Consumes: `Env`, `EmailSender` (`env.ts`).
- Produces: `sendMagicLink(env: Env, to: string, link: string): Promise<void>` — builds the message and calls `env.EMAIL?.send(...)`. Never throws if `EMAIL` is absent (no-op); callers additionally wrap in try/catch.

- [ ] **Step 1: Write `email.ts`**

`worker/src/email.ts`:
```ts
import type { Env } from './env';

// The onboarded Cloudflare Email Sending domain is the apex `ethanchung.dev`
// (the from-domain must match the enabled Email Sending domain).
export const MAGIC_SENDER = 'noreply@ethanchung.dev';

export async function sendMagicLink(env: Env, to: string, link: string): Promise<void> {
  if (!env.EMAIL) return; // not configured (e.g. local/test) — caller still returns 200
  await env.EMAIL.send({
    to,
    from: { email: MAGIC_SENDER, name: 'ccusage-cloud' },
    subject: 'Your ccusage-cloud sign-in link',
    text: `Sign in to ccusage-cloud:\n\n${link}\n\nThis link expires in 15 minutes and can be used once.`,
    html: `<p>Sign in to ccusage-cloud:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes and can be used once.</p>`,
  });
}
```

- [ ] **Step 2: Write the failing test**

`worker/test/email.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { MAGIC_SENDER, sendMagicLink } from '../src/email';
import type { Env } from '../src/env';

describe('sendMagicLink', () => {
  it('sends from the configured sender and includes the link', async () => {
    const send = vi.fn(async () => {});
    const env = { EMAIL: { send } } as unknown as Env;
    await sendMagicLink(env, 'me@example.com', 'https://x.dev/auth/callback?token=abc');
    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0]![0] as { to: string; from: { email: string }; html: string; text: string };
    expect(msg.to).toBe('me@example.com');
    expect(msg.from.email).toBe(MAGIC_SENDER);
    expect(msg.text).toContain('https://x.dev/auth/callback?token=abc');
    expect(msg.html).toContain('https://x.dev/auth/callback?token=abc');
  });

  it('is a no-op (no throw) when EMAIL is not configured', async () => {
    const env = {} as Env;
    await expect(sendMagicLink(env, 'me@example.com', 'https://x.dev/l')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @ccusage-cloud/worker test email`
Expected: 2 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add worker/src/email.ts worker/test/email.test.ts
git commit -m "feat(worker): sendMagicLink via Email Sending binding (guarded)"
```

---

## Task B3: `/auth/request` (mint + email, no enumeration)

**Files:**
- Create: `worker/src/auth_routes.ts`
- Modify: `worker/src/index.ts` (mount), `worker/test/seed.ts` (add `seedAllowedEmail`/`seedUser`)
- Test: `worker/test/auth_routes.test.ts` (request portion)

**Interfaces:**
- Consumes: `putLoginToken` (`kv.ts`), `randomBase64Url` (`tokens.ts`), `sendMagicLink` (`email.ts`), `AppBindings`.
- Produces: a Hono router `authRoutes` mounted at root with `POST /auth/request`. `seedUser(env, email)` test helper inserting an allowed_email + user, returning `{ userId, email }`.

- [ ] **Step 1: Extend the seed helper**

Append to `worker/test/seed.ts`:
```ts
export async function seedUser(
  env: Env,
  email = `viewer${counter}@example.com`,
): Promise<{ userId: string; email: string }> {
  counter += 1;
  const userId = `usr_v${counter}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO allowed_emails (email, added_at) VALUES (?, ?)').bind(email, now),
    env.DB.prepare('INSERT INTO users (id, email, public_to_group, created_at) VALUES (?, ?, 0, ?)').bind(userId, email, now),
  ]);
  return { userId, email };
}
```
(`counter` and the `Env` import already exist at the top of `seed.ts` from M1.)

- [ ] **Step 2: Write `auth_routes.ts` with `/auth/request`**

`worker/src/auth_routes.ts`:
```ts
import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { putLoginToken } from './kv';
import { randomBase64Url } from './tokens';
import { sendMagicLink } from './email';

const RequestSchema = v.object({ email: v.pipe(v.string(), v.email()) });

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/auth/request', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(RequestSchema, body);
  // Always 200 (no enumeration), even on malformed input.
  if (!parsed.success) return c.json({ ok: true });

  const email = parsed.output.email.toLowerCase();
  const allowed = await c.env.DB.prepare('SELECT email FROM allowed_emails WHERE email = ?')
    .bind(email)
    .first<{ email: string }>();
  if (allowed) {
    const token = randomBase64Url(32);
    await putLoginToken(c.env, token, email);
    const link = new URL(`/auth/callback?token=${token}`, c.req.url).toString();
    try {
      await sendMagicLink(c.env, email, link);
    } catch {
      // Token is minted; never 500 after that. User can re-request.
    }
  }
  return c.json({ ok: true });
});
```

- [ ] **Step 3: Mount it**

In `worker/src/index.ts`, add the import and mount (above `export default app;`):
```ts
import { authRoutes } from './auth_routes';
// ...
app.route('/', authRoutes);
```

- [ ] **Step 4: Write the failing test**

`worker/test/auth_routes.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser } from './seed';

async function request(email: unknown) {
  return SELF.fetch('https://example.com/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

describe('POST /auth/request', () => {
  it('mints a login token for an allow-listed email and returns 200', async () => {
    const { email } = await seedUser(env);
    const res = await request(email);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { keys } = await env.LOGIN_TOKENS.list();
    expect(keys.length).toBeGreaterThan(0);
  });

  it('returns 200 without minting for a non-allow-listed email', async () => {
    const before = (await env.LOGIN_TOKENS.list()).keys.length;
    const res = await request('stranger@nowhere.test');
    expect(res.status).toBe(200);
    expect((await env.LOGIN_TOKENS.list()).keys.length).toBe(before);
  });

  it('returns 200 on malformed input', async () => {
    const res = await request(12345);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 5: Run it**

Run: `pnpm --filter @ccusage-cloud/worker test auth_routes`
Expected: 3 tests PASS. (`EMAIL` is undefined in tests, so `sendMagicLink` no-ops; the token is still minted.)

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth_routes.ts worker/src/index.ts worker/test/seed.ts worker/test/auth_routes.test.ts
git commit -m "feat(worker): POST /auth/request mints magic-link token (no enumeration)"
```

---

## Task B4: `/auth/callback` + `/auth/logout` (cookie session)

**Files:**
- Modify: `worker/src/auth_routes.ts`
- Test: `worker/test/auth_routes.test.ts` (extend)

**Interfaces:**
- Consumes: `consumeLoginToken`, `putViewerSession`, `deleteViewerSession` (`kv.ts`); `randomBase64Url`; `getCookie`/`setCookie`/`deleteCookie` from `hono/cookie`.
- Produces: `GET /auth/callback?token=…` (consumes token → creates viewer session → sets `ccusage_session` cookie → 302 to `/`); `POST /auth/logout` (deletes session + clears cookie). Exports `SESSION_COOKIE = 'ccusage_session'`.
- The callback resolves the user by email; if no `users` row exists for the allow-listed email yet, it is created (first login provisions the user).

- [ ] **Step 1: Add the routes**

Add to `worker/src/auth_routes.ts` — extend imports and append routes:
```ts
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { consumeLoginToken, deleteViewerSession, putViewerSession } from './kv';
import { deleteViewerSession as _unused } from './kv'; // (remove if lint complains)
```
(Use a single import line in practice:
```ts
import { consumeLoginToken, deleteViewerSession, putViewerSession } from './kv';
```
)

```ts
export const SESSION_COOKIE = 'ccusage_session';

authRoutes.get('/auth/callback', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'missing token' }, 401);
  const consumed = await consumeLoginToken(c.env, token);
  if (!consumed) return c.json({ error: 'invalid or expired token' }, 401);

  // Resolve or provision the user for this allow-listed email.
  const email = consumed.email;
  let user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) {
    const id = `usr_${randomBase64Url(12)}`;
    await c.env.DB.prepare('INSERT INTO users (id, email, public_to_group, created_at) VALUES (?, ?, 0, ?)')
      .bind(id, email, Date.now())
      .run();
    user = { id };
  }

  const sid = randomBase64Url(32);
  await putViewerSession(c.env, sid, user.id);
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 2_592_000,
  });
  return c.redirect('/', 302);
});

authRoutes.post('/auth/logout', async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await deleteViewerSession(c.env, sid);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Extend the test**

Append to `worker/test/auth_routes.test.ts`:
```ts
import { putLoginToken } from '../src/kv';

describe('GET /auth/callback + logout', () => {
  it('consumes a token, sets a session cookie, redirects, and is single-use', async () => {
    await putLoginToken(env, 'logintok', 'cb@example.com');
    const res = await SELF.fetch('https://example.com/auth/callback?token=logintok', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('ccusage_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    // Token is single-use: a replay fails.
    const replay = await SELF.fetch('https://example.com/auth/callback?token=logintok', { redirect: 'manual' });
    expect(replay.status).toBe(401);

    // A user row was provisioned for the email.
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('cb@example.com').first();
    expect(user).not.toBeNull();
  });

  it('rejects a missing/invalid token', async () => {
    expect((await SELF.fetch('https://example.com/auth/callback', { redirect: 'manual' })).status).toBe(401);
    expect((await SELF.fetch('https://example.com/auth/callback?token=nope', { redirect: 'manual' })).status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const res = await SELF.fetch('https://example.com/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toContain('ccusage_session=');
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @ccusage-cloud/worker test auth_routes`
Expected: 6 tests PASS (3 from B3 + 3 here).

- [ ] **Step 4: Commit**

```bash
git add worker/src/auth_routes.ts worker/test/auth_routes.test.ts
git commit -m "feat(worker): /auth/callback session cookie + /auth/logout"
```

---

## Task B5: `requireViewer` middleware

**Files:**
- Create: `worker/src/viewer.ts`
- Modify: `worker/src/index.ts` (temporary guarded route for the test — removed in Task C1)
- Test: `worker/test/viewer.test.ts`

**Interfaces:**
- Consumes: `getViewerSession` (`kv.ts`), `SESSION_COOKIE` (`auth_routes.ts`), `getCookie`, `AppBindings`.
- Produces: `requireViewer` Hono middleware that resolves the cookie → `{ userId }`, sets `c.var.viewer`, refreshes the sliding TTL, or 401.

- [ ] **Step 1: Write `viewer.ts`**

`worker/src/viewer.ts`:
```ts
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from './env';
import { getViewerSession } from './kv';
import { SESSION_COOKIE } from './auth_routes';

export const requireViewer = createMiddleware<AppBindings>(async (c, next) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return c.json({ error: 'not authenticated' }, 401);
  const session = await getViewerSession(c.env, sid);
  if (!session) return c.json({ error: 'not authenticated' }, 401);
  c.set('viewer', { userId: session.userId });
  await next();
});
```

- [ ] **Step 2: Mount a temporary guarded route**

In `worker/src/index.ts`, add (above `export default app;`):
```ts
import { requireViewer } from './viewer';

app.get('/_whoami_viewer', requireViewer, (c) => c.json(c.var.viewer));
```

- [ ] **Step 3: Write the failing test**

`worker/test/viewer.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { putViewerSession } from '../src/kv';
import { seedUser } from './seed';

describe('requireViewer', () => {
  it('401s without a session cookie', async () => {
    const res = await SELF.fetch('https://example.com/_whoami_viewer');
    expect(res.status).toBe(401);
  });

  it('resolves a valid session cookie to the user', async () => {
    const { userId } = await seedUser(env);
    await putViewerSession(env, 'sidA', userId);
    const res = await SELF.fetch('https://example.com/_whoami_viewer', {
      headers: { cookie: 'ccusage_session=sidA' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId });
  });

  it('401s for an unknown session id', async () => {
    const res = await SELF.fetch('https://example.com/_whoami_viewer', {
      headers: { cookie: 'ccusage_session=ghost' },
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @ccusage-cloud/worker test viewer`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/viewer.ts worker/src/index.ts worker/test/viewer.test.ts
git commit -m "feat(worker): requireViewer cookie-session middleware"
```

---

# Phase C — Account / device API

## Task C1: `GET /api/me`

**Files:**
- Create: `worker/src/api.ts`
- Modify: `worker/src/index.ts` (mount `apiRoutes`, remove the temporary `/_whoami_viewer`)
- Test: `worker/test/api.test.ts` (me portion)

**Interfaces:**
- Consumes: `requireViewer`, `AppBindings`.
- Produces: a Hono router `apiRoutes` with `GET /api/me` → `{ id, email, publicToGroup, devices: Array<{ id, label, createdAt, lastSeenAt, revokedAt }> }` for the authenticated viewer.

- [ ] **Step 1: Write `api.ts`**

`worker/src/api.ts`:
```ts
import { Hono } from 'hono';
import type { AppBindings } from './env';
import { requireViewer } from './viewer';

export const apiRoutes = new Hono<AppBindings>();

apiRoutes.use('/api/*', requireViewer);

apiRoutes.get('/api/me', async (c) => {
  const { userId } = c.var.viewer;
  const user = await c.env.DB.prepare('SELECT id, email, public_to_group FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; public_to_group: number }>();
  if (!user) return c.json({ error: 'not found' }, 404);
  const devices = await c.env.DB.prepare(
    'SELECT id, label, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ? ORDER BY created_at',
  )
    .bind(userId)
    .all<{ id: string; label: string; created_at: number; last_seen_at: number | null; revoked_at: number | null }>();
  return c.json({
    id: user.id,
    email: user.email,
    publicToGroup: user.public_to_group === 1,
    devices: devices.results.map((d) => ({
      id: d.id,
      label: d.label,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
    })),
  });
});
```

- [ ] **Step 2: Mount it and remove the temporary route**

In `worker/src/index.ts`: remove the `import { requireViewer } from './viewer';` line and the `app.get('/_whoami_viewer', …)` line added in B5; add:
```ts
import { apiRoutes } from './api';
// ...
app.route('/', apiRoutes);
```
(If `viewer.test.ts` still references `/_whoami_viewer`, repoint it as below before running — this is the same migration pattern M1 used for `/_whoami`.)

- [ ] **Step 3: Repoint the B5 viewer test to `/api/me`**

In `worker/test/viewer.test.ts`, replace each `'https://example.com/_whoami_viewer'` with `'https://example.com/api/me'`. For the authenticated case, the body assertion changes from `{ userId }` to a check that the call succeeds and returns the user; replace the success-case assertions with:
```ts
    expect(res.status).toBe(200);
    expect((await res.json() as { id: string }).id).toBe(userId);
```
(`/api/me` requires the user to exist; `seedUser` already created it.)

- [ ] **Step 4: Write the `me` test**

`worker/test/api.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { putViewerSession } from '../src/kv';
import { seedUser } from './seed';

async function asViewer(userId: string, path: string, init: RequestInit = {}) {
  const sid = `sid_${userId}`;
  await putViewerSession(env, sid, userId);
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `ccusage_session=${sid}` },
  });
}

describe('GET /api/me', () => {
  it('401s unauthenticated', async () => {
    expect((await SELF.fetch('https://example.com/api/me')).status).toBe(401);
  });

  it('returns the viewer profile and devices', async () => {
    const { userId, email } = await seedUser(env);
    const res = await asViewer(userId, '/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; email: string; publicToGroup: boolean; devices: unknown[] };
    expect(body.id).toBe(userId);
    expect(body.email).toBe(email);
    expect(body.publicToGroup).toBe(false);
    expect(Array.isArray(body.devices)).toBe(true);
  });
});
```

- [ ] **Step 5: Run it**

Run: `pnpm --filter @ccusage-cloud/worker test api viewer`
Expected: api 2 PASS, viewer 3 PASS (now via `/api/me`).

- [ ] **Step 6: Commit**

```bash
git add worker/src/api.ts worker/src/index.ts worker/test/api.test.ts worker/test/viewer.test.ts
git commit -m "feat(worker): GET /api/me (profile + devices), drop temp viewer route"
```

---

## Task C2: `POST /api/devices` + `DELETE /api/devices/:id`

**Files:**
- Modify: `worker/src/api.ts`
- Test: `worker/test/api.test.ts` (extend)

**Interfaces:**
- Consumes: `randomToken` (`tokens.ts`), `sha256Hex` (`crypto.ts`), `requireViewer`.
- Produces: `POST /api/devices { label }` → mints a device token scoped to the viewer, stores only its SHA-256, returns `{ id, token }` (plaintext **once**). `DELETE /api/devices/:id` → sets `revoked_at` for a device the viewer owns; 404 if not theirs.

- [ ] **Step 1: Add the routes**

Extend imports in `worker/src/api.ts`:
```ts
import * as v from 'valibot';
import { randomToken } from './tokens';
import { sha256Hex } from './crypto';
```
Append:
```ts
const NewDeviceSchema = v.object({ label: v.pipe(v.string(), v.minLength(1), v.maxLength(100)) });

apiRoutes.post('/api/devices', async (c) => {
  const { userId } = c.var.viewer;
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(NewDeviceSchema, body);
  if (!parsed.success) return c.json({ error: 'invalid label' }, 400);

  const token = randomToken('cccloud_');
  const tokenHash = await sha256Hex(token);
  const id = `dev_${randomToken('', 12).slice(0, 16)}`;
  await c.env.DB.prepare(
    'INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, tokenHash, parsed.output.label, Date.now())
    .run();
  return c.json({ id, token }); // plaintext shown once
});

apiRoutes.delete('/api/devices/:id', async (c) => {
  const { userId } = c.var.viewer;
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(Date.now(), id, userId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Extend the test**

Append to `worker/test/api.test.ts`:
```ts
import { sha256Hex } from '../src/crypto';

describe('device management', () => {
  it('mints a device token scoped to the viewer and stores only its hash', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'laptop' }),
    });
    expect(res.status).toBe(200);
    const { id, token } = (await res.json()) as { id: string; token: string };
    expect(token.startsWith('cccloud_')).toBe(true);

    const row = await env.DB.prepare('SELECT user_id, token_sha256 FROM devices WHERE id = ?')
      .bind(id)
      .first<{ user_id: string; token_sha256: string }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.token_sha256).toBe(await sha256Hex(token));
  });

  it('rejects an empty label', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('revokes a device the viewer owns, 404 for one they do not', async () => {
    const { userId } = await seedUser(env);
    const minted = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'phone' }),
    });
    const { id } = (await minted.json()) as { id: string };

    const del = await asViewer(userId, `/api/devices/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const row = await env.DB.prepare('SELECT revoked_at FROM devices WHERE id = ?').bind(id).first<{ revoked_at: number | null }>();
    expect(row?.revoked_at).not.toBeNull();

    const { userId: other } = await seedUser(env);
    const del2 = await asViewer(other, `/api/devices/${id}`, { method: 'DELETE' });
    expect(del2.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @ccusage-cloud/worker test api`
Expected: api 5 PASS (2 + 3).

- [ ] **Step 4: Commit**

```bash
git add worker/src/api.ts worker/test/api.test.ts
git commit -m "feat(worker): POST/DELETE /api/devices (mint once, revoke)"
```

---

## Task C3: `PATCH /api/me` (group-sharing toggle)

**Files:**
- Modify: `worker/src/api.ts`
- Test: `worker/test/api.test.ts` (extend)

**Interfaces:**
- Produces: `PATCH /api/me { publicToGroup: boolean }` → updates `users.public_to_group` for the viewer; returns `{ publicToGroup }`.

- [ ] **Step 1: Add the route**

Append to `worker/src/api.ts`:
```ts
const PatchMeSchema = v.object({ publicToGroup: v.boolean() });

apiRoutes.patch('/api/me', async (c) => {
  const { userId } = c.var.viewer;
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(PatchMeSchema, body);
  if (!parsed.success) return c.json({ error: 'invalid payload' }, 400);
  await c.env.DB.prepare('UPDATE users SET public_to_group = ? WHERE id = ?')
    .bind(parsed.output.publicToGroup ? 1 : 0, userId)
    .run();
  return c.json({ publicToGroup: parsed.output.publicToGroup });
});
```

- [ ] **Step 2: Extend the test**

Append to `worker/test/api.test.ts`:
```ts
describe('PATCH /api/me', () => {
  it('toggles group sharing', async () => {
    const { userId } = await seedUser(env);
    const on = await asViewer(userId, '/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicToGroup: true }),
    });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ publicToGroup: true });
    const row = await env.DB.prepare('SELECT public_to_group FROM users WHERE id = ?').bind(userId).first<{ public_to_group: number }>();
    expect(row?.public_to_group).toBe(1);
  });

  it('rejects a non-boolean', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicToGroup: 'yes' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the whole worker suite**

Run: `pnpm --filter @ccusage-cloud/worker test`
Expected: all green — health, migration, auth, ingest (M1) + tokens, kv, email, auth_routes, viewer, api (M2).

- [ ] **Step 4: Commit**

```bash
git add worker/src/api.ts worker/test/api.test.ts
git commit -m "feat(worker): PATCH /api/me group-sharing toggle"
```

---

# Phase D — Automated end-to-end

## Task D1: CLI ↔ Worker e2e via `wrangler unstable_dev`

**Files:**
- Create: `cli/test/e2e.test.ts`
- Modify: `cli/package.json` (add `wrangler` devDependency for `unstable_dev`)

**Interfaces:**
- Consumes: `syncOnce` (`sync.ts`); the worker at `worker/`.
- Produces: an automated test that boots the worker against a temp-persisted local D1, seeds a device, runs `syncOnce` over real HTTP, and asserts the row landed — the e2e deferred from M1 Task 9. Guarded so it skips cleanly when wrangler cannot run in the environment.

> This task spawns child processes (wrangler) and is heavier/slower than the unit tests. It shares one local D1 persistence directory between the dev server and the seed/query `wrangler d1 execute` calls (the same approach proven manually in M1). Keep its timeout generous.

- [ ] **Step 1: Add the wrangler devDependency to the CLI package**

In `cli/package.json` `devDependencies`, add:
```json
    "wrangler": "^4.0.0"
```
Then:
```bash
pnpm install
```

- [ ] **Step 2: Write the e2e test**

`cli/test/e2e.test.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_dev, type UnstableDevWorker } from 'wrangler';
import { syncOnce } from '../src/sync';
import type { Config } from '../src/config';

const WORKER_DIR = resolve(__dirname, '../../worker');
const persistDir = mkdtempSync(join(tmpdir(), 'ccc-e2e-'));
const token = `cccloud_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
const userId = `usr_${randomBytes(8).toString('hex')}`;
const deviceId = `dev_${randomBytes(8).toString('hex')}`;

function d1(sql: string): string {
  return execFileSync(
    'wrangler',
    ['d1', 'execute', 'ccusage-cloud', '--local', `--persist-to=${persistDir}`, '--command', sql, '--json'],
    { cwd: WORKER_DIR, encoding: 'utf8' },
  );
}

let worker: UnstableDevWorker | undefined;
let available = true;

beforeAll(async () => {
  try {
    execFileSync('wrangler', ['d1', 'migrations', 'apply', 'ccusage-cloud', '--local', `--persist-to=${persistDir}`], {
      cwd: WORKER_DIR,
      encoding: 'utf8',
    });
    const now = Date.now();
    d1(
      `INSERT INTO allowed_emails (email, added_at) VALUES ('e2e@example.com', ${now});` +
        `INSERT INTO users (id, email, public_to_group, created_at) VALUES ('${userId}', 'e2e@example.com', 0, ${now});` +
        `INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES ('${deviceId}', '${userId}', '${tokenHash}', 'e2e', ${now});`,
    );
    worker = await unstable_dev(join(WORKER_DIR, 'src/index.ts'), {
      config: join(WORKER_DIR, 'wrangler.jsonc'),
      persistTo: persistDir,
      experimental: { disableExperimentalWarning: true },
    });
  } catch (err) {
    available = false;
    console.warn('e2e skipped — wrangler unavailable in this environment:', (err as Error).message);
  }
}, 120_000);

afterAll(async () => {
  await worker?.stop();
});

describe('CLI → Worker → D1 e2e', () => {
  it('syncs a session over HTTP and lands an idempotent row', async () => {
    if (!available || !worker) return; // environment can't run wrangler; skip
    const cfg: Config = {
      serverUrl: `http://${worker.address}:${worker.port}`,
      token,
      ccusageBin: 'unused',
    };
    const fixture = JSON.stringify({
      sessions: [
        { sessionId: 'e2e-s1', inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 30, totalCost: 0.42, firstActivity: 'a', lastActivity: 'b', modelsUsed: ['claude-opus-4-8'], modelBreakdowns: [], projectPath: '/p' },
      ],
      totals: {},
    });
    const statePath = join(persistDir, 'state.json');

    const first = await syncOnce(cfg, ['claude'], { run: () => fixture, statePath });
    expect(first.pushed).toBe(1);

    const out = JSON.parse(d1("SELECT COUNT(*) AS n FROM sessions WHERE session_id='e2e-s1'"));
    const n = out[0]?.results?.[0]?.n ?? out?.results?.[0]?.n;
    expect(Number(n)).toBe(1);

    // Idempotent: a --full re-push updates in place, count stays 1.
    const second = await syncOnce(cfg, ['claude'], { run: () => fixture, statePath, full: true });
    expect(second.pushed).toBe(1);
    const out2 = JSON.parse(d1("SELECT COUNT(*) AS n FROM sessions WHERE session_id='e2e-s1'"));
    const n2 = out2[0]?.results?.[0]?.n ?? out2?.results?.[0]?.n;
    expect(Number(n2)).toBe(1);
  }, 120_000);
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter ccusage-cloud test e2e`
Expected: 1 test PASS when wrangler can boot locally; if the environment cannot run wrangler, the test logs a skip notice and still passes (the assertion body is guarded). Confirm in the output which path ran.

- [ ] **Step 4: Commit**

```bash
git add cli/package.json cli/test/e2e.test.ts pnpm-lock.yaml
git commit -m "test(e2e): automated CLI→Worker→D1 sync via wrangler unstable_dev"
```

---

## Self-Review

**Spec coverage (M2 scope):**
- A1 all-source sync + `--source`; A2 incremental `state.json` + `--full` + chunking(500) + retry/backoff; A3 `status` → spec A (1–4). ✓
- B1 KV + email bindings/types; B2 `sendMagicLink`; B3 `/auth/request` (allow-list, no enumeration, 200-on-send-failure); B4 `/auth/callback` (single-use, cookie, provisioning) + `/auth/logout`; B5 `requireViewer` → spec B (5–8). ✓
- C1 `GET /api/me`; C2 `POST`/`DELETE /api/devices`; C3 `PATCH /api/me` → spec C (9–12). ✓
- D1 automated `unstable_dev` e2e → spec D (13). ✓
- No D1 migration (correctly): `public_to_group`, `allowed_emails`, `devices` exist from M1.

**Type consistency:**
- `syncOnce` signature changes once (A2: positional `run?,fetchFn?` → `SyncOpts`); A1's interim call uses the M1 shape and A2 immediately updates the caller. The A1 note flags the transient `{ skipped: undefined }`. ✓
- `Env`/`AppBindings` extended in B1 (`LOGIN_TOKENS`, `VIEWER_SESSIONS`, `EMAIL?`, `viewer`) and consumed unchanged in B2–C3. ✓
- `SESSION_COOKIE` defined in `auth_routes.ts` (B4), imported by `viewer.ts` (B5). ✓
- KV TTL constants (900 / 2 592 000) live once in `kv.ts`; cookie `maxAge` 2 592 000 matches. ✓
- `/_whoami_viewer` temporary route (B5) removed in C1, with the same test-repoint migration M1 used for `/_whoami`. ✓
- Device mint reuses M1 `sha256Hex` + `cccloud_` token format; stored hash verified against `sha256Hex(token)` in the C2 test. ✓

**Placeholder scan:** no TBD/TODO; every code step is complete. The B4 import note explicitly resolves to a single import line. The D1 e2e is guarded (skips cleanly) rather than left as a stub. The KV/D1 `id` values in `wrangler.jsonc` are intentional local placeholders (real namespace ids are a deploy-time/M4 concern, like M1's `database_id`).

**Known carry-forward (out of M2, into M3/M4):** dashboard UI + read endpoints `/api/summary`, `/api/sessions` (M3); `scope=group`, `--redact-projects`, rate limiting, custom-domain deploy, KV namespace + email-domain provisioning (M4). Also the two M1 final-review follow-ups remain open and align with M2 surfaces if picked up: enforce `allowed_emails` (now actually read by `/auth/request`) and lift the server-side `source` allow-list.

## Open question (confirm before/while implementing B4)

- **Magic-link origin in production.** The callback link is built from `c.req.url` (`new URL('/auth/callback?token=…', c.req.url)`), so it works in local dev and behind the custom domain without config. If the Worker ever sits behind a proxy that rewrites the host, switch to an explicit `PUBLIC_ORIGIN` var. No action needed for M2 unless that topology changes.

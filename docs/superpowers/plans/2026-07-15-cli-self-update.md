# CLI Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a successful `sync`, the CLI refreshes its own `cli.js` from the server (conditional GET + stored ETag) so the next sync runs the latest code — best-effort, never affecting sync.

**Architecture:** A new isolated module `cli/src/selfupdate.ts` exposes `maybeSelfUpdate()` plus a tiny `cli.etag` file store. `run()` in `index.ts` stays pure; the real `isMain` entry point calls `maybeSelfUpdate()` only after a clean `sync`. No worker change — Cloudflare `ASSETS` already serves `/cli.js` with an `ETag` and honors `If-None-Match`.

**Tech Stack:** TypeScript, Node ≥ 20 (built-in `fetch`), tsup (esm bundle), vitest.

## Global Constraints

- Node.js **≥ 20** runtime (installer already enforces this).
- CLI bundle must stay dependency-free at runtime — only `node:*` built-ins and inlined deps (`tsup noExternal: [/./]`). Do **not** add npm deps to `cli/`.
- Config/state dir: `${XDG_CONFIG_HOME:-~/.config}/ccusage-cloud/`. Files written there are `chmod 600` (match `config.ts` / `state.ts`).
- Opt-out env var name, verbatim: `CCUSAGE_CLOUD_NO_SELF_UPDATE`.
- On-update notice text, verbatim: `Updated CLI to latest.`
- Self-update must never throw out of `sync` or change its exit code.
- `run()` in `index.ts` must remain pure (returns exit code, no self-update) so existing tests are untouched.

---

### Task 1: `cli.etag` file store + `maybeSelfUpdate`

**Files:**
- Create: `cli/src/selfupdate.ts`
- Test: `cli/test/selfupdate.test.ts`

**Interfaces:**
- Consumes: `loadConfig(path?)` from `./config` (returns `Config | null`, `Config.serverUrl: string`).
- Produces:
  - `etagPath(): string` → `${configdir}/cli.etag`
  - `loadEtag(path?: string): string | null`
  - `saveEtag(etag: string, path?: string): void`
  - `interface SelfUpdateOpts { cliPath: string; fetchFn?: typeof fetch; configPath?: string; etagPath?: string; }`
  - `maybeSelfUpdate(opts: SelfUpdateOpts): Promise<boolean>` — resolves `true` iff it replaced the file; never rejects.

- [ ] **Step 1: Write the failing tests**

Create `cli/test/selfupdate.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybeSelfUpdate, loadEtag, saveEtag } from '../src/selfupdate';

const OLD = 'console.log("old cli")\n';
const NEW = 'console.log("new cli")\n';

function tmpdirFor(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A temp workspace: a cli.js file, a config.json pointing at a server, and an etag path.
function workspace(cliBody = OLD) {
  const dir = tmpdirFor('ccc-su-');
  const cliPath = join(dir, 'cli.js');
  const configPath = join(dir, 'config.json');
  const etagPath = join(dir, 'cli.etag');
  writeFileSync(cliPath, cliBody);
  writeFileSync(
    configPath,
    JSON.stringify({ serverUrl: 'https://api.example.dev', token: 't', ccusageBin: 'ccusage' }),
  );
  return { dir, cliPath, configPath, etagPath };
}

afterEach(() => {
  delete process.env.CCUSAGE_CLOUD_NO_SELF_UPDATE;
});

describe('maybeSelfUpdate', () => {
  it('replaces cli.js and stores the ETag on a 200 with new content', async () => {
    const ws = workspace();
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200, headers: { etag: '"v2"' } }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(true);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(NEW);
    expect(loadEtag(ws.etagPath)).toBe('"v2"');
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://api.example.dev/cli.js');
  });

  it('sends a stored ETag as If-None-Match and no-ops on 304', async () => {
    const ws = workspace();
    saveEtag('"v1"', ws.etagPath);
    const fetchFn = vi.fn(async () => new Response(null, { status: 304 }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(OLD);
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('"v1"');
  });

  it('does not rewrite when 200 body is identical, but stores the ETag', async () => {
    const ws = workspace(OLD);
    const fetchFn = vi.fn(async () => new Response(OLD, { status: 200, headers: { etag: '"same"' } }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(loadEtag(ws.etagPath)).toBe('"same"');
  });

  it('no-ops when the target is not named cli.js', async () => {
    const ws = workspace();
    const other = join(ws.dir, 'vitest-runner.js');
    writeFileSync(other, OLD);
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200 }));
    const updated = await maybeSelfUpdate({
      cliPath: other,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('no-ops (no network) when the opt-out env var is set', async () => {
    process.env.CCUSAGE_CLOUD_NO_SELF_UPDATE = '1';
    const ws = workspace();
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200 }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('no-ops when there is no config', async () => {
    const dir = tmpdirFor('ccc-su-');
    const cliPath = join(dir, 'cli.js');
    writeFileSync(cliPath, OLD);
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200 }));
    const updated = await maybeSelfUpdate({
      cliPath,
      configPath: join(dir, 'missing.json'),
      etagPath: join(dir, 'cli.etag'),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('swallows fetch errors and leaves the file untouched', async () => {
    const ws = workspace();
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(OLD);
  });

  it('never writes an empty body over cli.js', async () => {
    const ws = workspace();
    const fetchFn = vi.fn(async () => new Response('   ', { status: 200, headers: { etag: '"blank"' } }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(OLD);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cli && npx vitest run test/selfupdate.test.ts`
Expected: FAIL — `Cannot find module '../src/selfupdate'` (module not created yet).

- [ ] **Step 3: Implement `cli/src/selfupdate.ts`**

```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { loadConfig } from './config';

export function etagPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'ccusage-cloud', 'cli.etag');
}

export function loadEtag(path = etagPath()): string | null {
  if (!existsSync(path)) return null;
  const v = readFileSync(path, 'utf8').trim();
  return v.length > 0 ? v : null;
}

export function saveEtag(etag: string, path = etagPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${etag}\n`);
  chmodSync(path, 0o600);
}

export interface SelfUpdateOpts {
  cliPath: string;
  fetchFn?: typeof fetch;
  configPath?: string;
  etagPath?: string;
}

// Best-effort. Never throws; returns true iff cli.js was replaced.
export async function maybeSelfUpdate(opts: SelfUpdateOpts): Promise<boolean> {
  try {
    if (process.env.CCUSAGE_CLOUD_NO_SELF_UPDATE) return false;
    if (basename(opts.cliPath) !== 'cli.js') return false;

    const cfg = loadConfig(opts.configPath);
    if (!cfg) return false;

    const fetchFn = opts.fetchFn ?? fetch;
    const eTagFile = opts.etagPath ?? etagPath();
    const stored = loadEtag(eTagFile);

    const headers: Record<string, string> = {};
    if (stored) headers['if-none-match'] = stored;

    const res = await fetchFn(new URL('/cli.js', cfg.serverUrl), { headers });
    if (res.status === 304) return false;
    if (!res.ok) return false;

    const body = await res.text();
    if (!body.trim()) return false; // never write an empty/blank CLI

    const newEtag = res.headers.get('etag');

    const current = existsSync(opts.cliPath) ? readFileSync(opts.cliPath, 'utf8') : null;
    if (current === body) {
      if (newEtag) saveEtag(newEtag, eTagFile);
      return false;
    }

    const tmp = `${opts.cliPath}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, opts.cliPath); // atomic replace; overwrites on Windows
    if (newEtag) saveEtag(newEtag, eTagFile);
    console.log('Updated CLI to latest.');
    return true;
  } catch {
    return false; // best-effort: never let self-update break sync
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cli && npx vitest run test/selfupdate.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/src/selfupdate.ts cli/test/selfupdate.test.ts
git commit -m "feat(cli): add best-effort self-update module"
```

---

### Task 2: Wire self-update into the `sync` entry point

**Files:**
- Modify: `cli/src/index.ts` (the `isMain` block at the bottom, ~lines 145-160)

**Interfaces:**
- Consumes: `maybeSelfUpdate({ cliPath })` from `./selfupdate` (Task 1).
- Produces: no new exports. `run()` is unchanged; self-update fires only from the real process after a clean `sync`.

- [ ] **Step 1: Confirm the current entry block**

Run: `cd cli && sed -n '145,170p' src/index.ts`
Expected: the `isMain` block that currently does
`run(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(...)`.
(Already carries the earlier exit-crash fix — `process.exitCode`, not `process.exit()`.)

- [ ] **Step 2: Replace the `isMain` block**

Replace the entire `if (isMain) { ... }` block with:

```ts
if (isMain) {
  // Set exitCode and let the event loop drain instead of calling process.exit().
  // A synchronous process.exit() right after fetch() aborts on Windows with
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c"
  // because libuv is still tearing down undici's keep-alive handle. Idle undici
  // sockets are unref'd on Node >= 20, so the process still exits promptly.
  const argv = process.argv.slice(2);
  run(argv)
    .then(async (code) => {
      // Best-effort self-update: only after a clean sync, only in the real
      // bundled CLI process. Never affects sync's exit code.
      if (code === 0 && argv[0] === 'sync') {
        const { maybeSelfUpdate } = await import('./selfupdate');
        await maybeSelfUpdate({ cliPath: process.argv[1] }).catch(() => {});
      }
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 3: Typecheck + full test suite (nothing regressed)**

Run: `cd cli && npx tsc --noEmit && npm test`
Expected: tsc clean; all tests PASS (existing 45 + 8 new = 53). `run()` is untouched, so no existing test changes behavior.

- [ ] **Step 4: Verify the built bundle carries the wiring**

Run: `cd cli && npm run build:bundle && node -e "const s=require('fs').readFileSync('../dashboard/public/cli.js','utf8'); if(!s.includes('Updated CLI to latest.')) throw new Error('self-update string missing from bundle'); console.log('bundle OK')"`
Expected: `bundle OK` — the minified bundle contains the self-update path (tsup inlines the dynamic `import('./selfupdate')`).

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts dashboard/public/cli.js
git commit -m "feat(cli): self-update after a clean sync"
```

Note: `dashboard/public/cli.js` is gitignored (build artifact). The `git add` above is a no-op if ignored — that's expected; the real bundle is regenerated at deploy. Drop it from the commit if `git status` shows it ignored.

---

### Task 3: Verify Cloudflare `ASSETS` serves `/cli.js` with a working ETag / 304

**Files:**
- None (verification only). If ASSETS does **not** return an `ETag`/`304`, capture findings for a follow-up; the feature still degrades correctly (content-compare on every 200).

**Interfaces:**
- Consumes: the deployed worker's `/cli.js` route (`worker/src/index.ts:78` catch-all → `c.env.ASSETS.fetch`).

- [ ] **Step 1: Check ETag presence against the running server**

Run (against the real deployment, or a local `wrangler dev` if the deployed build predates this change):
`curl -sI https://ccusage.ethanchung.dev/cli.js | grep -i etag`
Expected: an `ETag:` header is present.

- [ ] **Step 2: Check conditional 304**

Run:
```bash
ETAG=$(curl -sI https://ccusage.ethanchung.dev/cli.js | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" https://ccusage.ethanchung.dev/cli.js
```
Expected: `304`.

- [ ] **Step 3: Record the result**

If both pass: the conditional-GET fast path works end-to-end — note it in the PR description.
If either fails: note that ASSETS isn't honoring conditional requests here; self-update still works via the identical-body guard (downloads each sync, writes only on change). No code change required for correctness, but flag it for a possible follow-up (e.g. a dedicated version route).

- [ ] **Step 4: No commit** (verification task; findings go in the PR description).

---

## Self-Review

**Spec coverage:**
- New module `selfupdate.ts` with `maybeSelfUpdate` → Task 1. ✓
- Opt-out env var / basename guard / config guard / empty-body / identical-body / atomic write / ETag store → Task 1 (impl + tests). ✓
- Conditional GET + stored ETag / 304 → Task 1 (tests) + Task 3 (live verify). ✓
- Wiring in `index.ts`, `run()` stays pure, only after clean `sync`, carries exit fix → Task 2. ✓
- Silent + one-line notice `Updated CLI to latest.` → Task 1 impl + Task 2 bundle check. ✓
- No worker change; ASSETS ETag assumption → Task 3 verification. ✓
- Rollout (rebuild bundle, redeploy) → Task 2 Step 4 + PR notes.

**Placeholder scan:** No TBD/TODO; all code and commands are concrete. ✓

**Type consistency:** `maybeSelfUpdate(opts: SelfUpdateOpts)`, `loadEtag`/`saveEtag`/`etagPath`, `SelfUpdateOpts` fields (`cliPath`, `fetchFn`, `configPath`, `etagPath`) are identical across the module, its tests, and the `index.ts` call site (`{ cliPath }`). `loadConfig(path?)`/`Config.serverUrl` match `config.ts`. ✓

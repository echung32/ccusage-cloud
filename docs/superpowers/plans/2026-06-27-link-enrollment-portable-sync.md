# Link-based Device Enrollment + Portable One-Liner Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user generate a one-time enroll link in the dashboard and paste a single cross-platform command on any machine to register that machine as a device and sync its ccusage stats.

**Architecture:** The dashboard mints a short-lived, single-use *claim code* (stored hashed in D1). A public `/api/enroll` endpoint redeems a code into a real device token. The Worker serves OS-specific bootstrap scripts (`/i.sh`, `/i.ps1`) with the server URL and code templated in, plus a self-contained bundled CLI (`/cli.js`). The bootstrap downloads `cli.js`, runs a new `ccusage-cloud enroll` command (auto-labels from hostname, writes config), then runs the existing `sync`.

**Tech Stack:** Cloudflare Workers (Hono), D1 (SQLite), KV (rate limiting), valibot; CLI is TypeScript→ESM via tsup, Node ≥20; dashboard is Astro + React + Cloudscape.

## Global Constraints

- **Node ≥ 20** and `ccusage` on `PATH` are the only machine prerequisites; the bootstrap must not assume the ccusage-cloud CLI is pre-installed.
- **No new runtime dependencies** in the Worker or CLI — use built-ins, `hono`, and `valibot` only.
- **Secrets are hashed at rest.** Claim codes and device tokens are stored only as SHA-256 hex (`sha256Hex`), never plaintext.
- **Claim codes:** prefix `ec_`, 15-minute TTL, single-use. Device tokens: prefix `cccloud_`. Device ids: `dev_<16 chars>`. Use the existing `randomToken(prefix)` helper.
- **Cross-platform:** every user-facing one-liner must have both a POSIX `sh` form and a Windows PowerShell form.
- **Self-hosted:** all artifacts (`i.sh`, `i.ps1`, `cli.js`) are served by the user's own Worker. Nothing is published to npm.
- **One link = one device.** Redeeming a code creates exactly one device, then the code is dead.
- **`/api/enroll` is public; `/api/enroll-codes` requires the dashboard JWT.** Do not place `/api/enroll` under the `requireUser` middleware.

## File Structure

**Worker (`worker/`):**
- Create `migrations/0002_enroll_codes.sql` — `enroll_codes` table.
- Create `src/enroll.ts` — `mintEnrollCode` (authed) and `redeemEnrollCode` (public) handlers.
- Create `src/bootstrap.ts` — `/i.sh` and `/i.ps1` script routes (templated).
- Modify `src/api.ts` — register `POST /api/enroll-codes`.
- Modify `src/index.ts` — register public `POST /api/enroll` and the bootstrap routes.
- Create `test/enroll.test.ts`, `test/bootstrap.test.ts`.

**CLI (`cli/`):**
- Create `src/enroll.ts` — `enrollDevice()`.
- Modify `src/index.ts` — `enroll` command + `code` arg + help text.
- Modify `package.json` — `build:bundle` script.
- Create `test/enroll.test.ts`.

**Dashboard (`dashboard/`):**
- Create `src/lib/install.ts` — `buildInstallCommands(origin, code)`.
- Modify `src/lib/api.ts` — `createEnrollLink()`.
- Modify `src/lib/types.ts` — `EnrollCode`.
- Modify `src/components/SettingsDevices.tsx` — "Enroll a device" UI.
- Create `src/lib/install.test.ts`.

**Repo root / docs:**
- Modify `.gitignore` — ignore generated `dashboard/public/cli.js`.
- Modify `README.md`, `docs/DEPLOY.md` — new flow + build order.

---

## Task 1: D1 migration for `enroll_codes`

**Files:**
- Create: `worker/migrations/0002_enroll_codes.sql`
- Test: `worker/test/enroll.test.ts`

**Interfaces:**
- Produces: table `enroll_codes(code_sha256 TEXT PK, user_id TEXT, created_at INTEGER, expires_at INTEGER, used_at INTEGER NULL)`. The vitest workers pool auto-applies all files in `migrations/` (via `readD1Migrations` in `worker/vitest.config.ts`), so later tasks can rely on the table existing in tests.

- [ ] **Step 1: Write the failing test**

Create `worker/test/enroll.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('enroll_codes migration', () => {
  it('exposes a writable enroll_codes table', async () => {
    await env.DB.prepare(
      'INSERT INTO enroll_codes (code_sha256, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
      .bind('hash_abc', 'usr_x', 1000, 2000)
      .run();
    const row = await env.DB.prepare('SELECT user_id, used_at FROM enroll_codes WHERE code_sha256 = ?')
      .bind('hash_abc')
      .first<{ user_id: string; used_at: number | null }>();
    expect(row?.user_id).toBe('usr_x');
    expect(row?.used_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccusage-cloud/worker test enroll`
Expected: FAIL — `no such table: enroll_codes`.

- [ ] **Step 3: Create the migration**

Create `worker/migrations/0002_enroll_codes.sql`:

```sql
CREATE TABLE enroll_codes (
  code_sha256 TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX idx_enroll_codes_user ON enroll_codes(user_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccusage-cloud/worker test enroll`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0002_enroll_codes.sql worker/test/enroll.test.ts
git commit -m "feat(worker): add enroll_codes table"
```

---

## Task 2: Worker — mint claim codes (`POST /api/enroll-codes`)

**Files:**
- Create: `worker/src/enroll.ts`
- Modify: `worker/src/api.ts` (add import + route)
- Test: `worker/test/enroll.test.ts` (append)

**Interfaces:**
- Consumes: `randomToken` from `./tokens`, `sha256Hex` from `./crypto`, `AppBindings` from `./env`, `c.var.viewer.userId` (set by `requireUser`).
- Produces: `export const mintEnrollCode: (c: Context<AppBindings>) => Promise<Response>`. Responds `200 { code: string, expiresAt: number }`. Inserts a row with `code_sha256 = sha256Hex(code)`, `expires_at = now + 15*60*1000`.

- [ ] **Step 1: Write the failing test**

Append to `worker/test/enroll.test.ts` (add imports at top of file):

```ts
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, mintToken } from './auth-fixture';
import { seedUser } from './seed';
import { sha256Hex } from '../src/crypto';

beforeAll(() => installJwks());

async function asViewer(userId: string, path: string, init: RequestInit = {}) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
}

describe('POST /api/enroll-codes', () => {
  it('401s unauthenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/enroll-codes', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('mints a code for the viewer and stores only its hash', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/enroll-codes', { method: 'POST' });
    expect(res.status).toBe(200);
    const { code, expiresAt } = (await res.json()) as { code: string; expiresAt: number };
    expect(code.startsWith('ec_')).toBe(true);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const row = await env.DB.prepare('SELECT user_id, code_sha256, used_at FROM enroll_codes WHERE code_sha256 = ?')
      .bind(await sha256Hex(code))
      .first<{ user_id: string; code_sha256: string; used_at: number | null }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.used_at).toBeNull();
  });
});
```

(The existing migration test from Task 1 stays; merge the imports so they appear once.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccusage-cloud/worker test enroll`
Expected: FAIL — `/api/enroll-codes` returns 404 (route not defined).

- [ ] **Step 3: Create the mint handler**

Create `worker/src/enroll.ts`:

```ts
import type { Context } from 'hono';
import type { AppBindings } from './env';
import { randomToken } from './tokens';
import { sha256Hex } from './crypto';

const CODE_TTL_MS = 15 * 60 * 1000;

export const mintEnrollCode = async (c: Context<AppBindings>) => {
  const { userId } = c.var.viewer;
  const code = randomToken('ec_');
  const codeHash = await sha256Hex(code);
  const now = Date.now();
  const expiresAt = now + CODE_TTL_MS;
  await c.env.DB.prepare(
    'INSERT INTO enroll_codes (code_sha256, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(codeHash, userId, now, expiresAt)
    .run();
  return c.json({ code, expiresAt });
};
```

- [ ] **Step 4: Register the route**

In `worker/src/api.ts`, add the import near the other imports:

```ts
import { mintEnrollCode } from './enroll';
```

Then add this route (place it right after the `POST /api/devices` handler, so it inherits the `apiRoutes.use('/api/*', requireUser)` guard):

```ts
apiRoutes.post('/api/enroll-codes', mintEnrollCode);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ccusage-cloud/worker test enroll`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/enroll.ts worker/src/api.ts worker/test/enroll.test.ts
git commit -m "feat(worker): mint single-use enroll codes"
```

---

## Task 3: Worker — redeem claim codes (`POST /api/enroll`)

**Files:**
- Modify: `worker/src/enroll.ts` (add `redeemEnrollCode`)
- Modify: `worker/src/index.ts` (register public route)
- Test: `worker/test/enroll.test.ts` (append)

**Interfaces:**
- Consumes: `rateLimit` from `./ratelimit`, `randomToken`, `sha256Hex`, valibot, the `enroll_codes` and `devices` tables.
- Produces: `export const redeemEnrollCode: (c: Context<AppBindings>) => Promise<Response>`. Public (no `requireUser`). Body `{ code: string, label: string }`. On success: `200 { id, token }` and a new `devices` row; the code's `used_at` is set. On invalid/expired/used/unknown code: `410`. On bad body: `400`. On rate limit: `429`.

- [ ] **Step 1: Write the failing test**

Append to `worker/test/enroll.test.ts`:

```ts
async function mintCode(userId: string): Promise<string> {
  const res = await asViewer(userId, '/api/enroll-codes', { method: 'POST' });
  return ((await res.json()) as { code: string }).code;
}

async function redeem(code: string, label = 'test-host') {
  return SELF.fetch('https://example.com/api/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, label }),
  });
}

describe('POST /api/enroll', () => {
  it('redeems a code into a device and marks the code used', async () => {
    const { userId } = await seedUser(env);
    const code = await mintCode(userId);
    const res = await redeem(code, 'my-laptop');
    expect(res.status).toBe(200);
    const { id, token } = (await res.json()) as { id: string; token: string };
    expect(token.startsWith('cccloud_')).toBe(true);

    const device = await env.DB.prepare('SELECT user_id, label, token_sha256 FROM devices WHERE id = ?')
      .bind(id)
      .first<{ user_id: string; label: string; token_sha256: string }>();
    expect(device?.user_id).toBe(userId);
    expect(device?.label).toBe('my-laptop');
    expect(device?.token_sha256).toBe(await sha256Hex(token));

    const used = await env.DB.prepare('SELECT used_at FROM enroll_codes WHERE code_sha256 = ?')
      .bind(await sha256Hex(code))
      .first<{ used_at: number | null }>();
    expect(used?.used_at).not.toBeNull();
  });

  it('410s on a second redemption of the same code', async () => {
    const { userId } = await seedUser(env);
    const code = await mintCode(userId);
    expect((await redeem(code)).status).toBe(200);
    expect((await redeem(code)).status).toBe(410);
  });

  it('410s on an unknown code', async () => {
    expect((await redeem('ec_does_not_exist')).status).toBe(410);
  });

  it('410s on an expired code', async () => {
    const { userId } = await seedUser(env);
    const code = await mintCode(userId);
    await env.DB.prepare('UPDATE enroll_codes SET expires_at = ? WHERE code_sha256 = ?')
      .bind(Date.now() - 1000, await sha256Hex(code))
      .run();
    expect((await redeem(code)).status).toBe(410);
  });

  it('400s on a missing label', async () => {
    const { userId } = await seedUser(env);
    const code = await mintCode(userId);
    const res = await SELF.fetch('https://example.com/api/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccusage-cloud/worker test enroll`
Expected: FAIL — `/api/enroll` returns 404.

- [ ] **Step 3: Add the redeem handler**

Append to `worker/src/enroll.ts` (add the new imports to the existing import block):

```ts
import * as v from 'valibot';
import { rateLimit } from './ratelimit';

const EnrollSchema = v.object({
  code: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
});

export const redeemEnrollCode = async (c: Context<AppBindings>) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env.RATE_LIMITS, `enroll:${ip}`, 30, 60);
  if (!rl.ok) return c.json({ error: 'rate limited' }, 429);

  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(EnrollSchema, body);
  if (!parsed.success) return c.json({ error: 'invalid payload' }, 400);

  const codeHash = await sha256Hex(parsed.output.code);
  const now = Date.now();
  const row = await c.env.DB.prepare('SELECT user_id FROM enroll_codes WHERE code_sha256 = ?')
    .bind(codeHash)
    .first<{ user_id: string }>();
  if (!row) return c.json({ error: 'invalid or expired code' }, 410);

  // Atomically claim the code: only succeeds if still unused and unexpired.
  const claim = await c.env.DB.prepare(
    'UPDATE enroll_codes SET used_at = ? WHERE code_sha256 = ? AND used_at IS NULL AND expires_at > ?',
  )
    .bind(now, codeHash, now)
    .run();
  if (claim.meta.changes === 0) return c.json({ error: 'invalid or expired code' }, 410);

  const token = randomToken('cccloud_');
  const tokenHash = await sha256Hex(token);
  const id = `dev_${randomToken('', 12).slice(0, 16)}`;
  await c.env.DB.prepare(
    'INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, row.user_id, tokenHash, parsed.output.label, now)
    .run();
  return c.json({ id, token });
};
```

- [ ] **Step 4: Register the public route**

In `worker/src/index.ts`, add the import:

```ts
import { redeemEnrollCode } from './enroll';
```

Then register it **before** `app.route('/', apiRoutes);` (so this public route wins over the authed `/api/*` router) — place it right after the `/ingest` handler:

```ts
app.post('/api/enroll', redeemEnrollCode);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ccusage-cloud/worker test enroll`
Expected: PASS (all redeem cases).

- [ ] **Step 6: Commit**

```bash
git add worker/src/enroll.ts worker/src/index.ts worker/test/enroll.test.ts
git commit -m "feat(worker): redeem enroll codes into device tokens"
```

---

## Task 4: Worker — bootstrap script routes (`/i.sh`, `/i.ps1`)

**Files:**
- Create: `worker/src/bootstrap.ts`
- Modify: `worker/src/index.ts` (mount routes)
- Test: `worker/test/bootstrap.test.ts`

**Interfaces:**
- Consumes: `AppBindings`. Reads `c.req.query('c')` and `new URL(c.req.url).origin`.
- Produces: `export const bootstrapRoutes: Hono<AppBindings>` serving `GET /i.sh` and `GET /i.ps1`. Returns `text/plain` script bodies with the origin and code interpolated. Rejects codes not matching `^[A-Za-z0-9_-]+$` with `400`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/bootstrap.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /i.sh', () => {
  it('returns a shell script templated with server + code', async () => {
    const res = await SELF.fetch('https://example.com/i.sh?c=ec_abc123');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('https://example.com');
    expect(body).toContain('ec_abc123');
    expect(body).toContain('/cli.js');
    expect(body).toContain('enroll');
    expect(body).toContain('sync');
  });

  it('400s on a malformed code', async () => {
    const res = await SELF.fetch('https://example.com/i.sh?c=bad;rm -rf');
    expect(res.status).toBe(400);
  });
});

describe('GET /i.ps1', () => {
  it('returns a PowerShell script templated with server + code', async () => {
    const res = await SELF.fetch('https://example.com/i.ps1?c=ec_abc123');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('https://example.com');
    expect(body).toContain('ec_abc123');
    expect(body).toContain('Invoke-WebRequest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccusage-cloud/worker test bootstrap`
Expected: FAIL — `/i.sh` returns 404 (served by asset catch-all as not-found).

- [ ] **Step 3: Create the bootstrap routes**

Create `worker/src/bootstrap.ts`:

```ts
import { Hono } from 'hono';
import type { AppBindings } from './env';

const CODE_RE = /^[A-Za-z0-9_-]+$/;

function shScript(server: string, code: string): string {
  return `#!/bin/sh
set -e
SERVER="${server}"
CODE="${code}"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 20 is required. Install it from https://nodejs.org (ccusage needs it too)." >&2
  exit 1
fi
DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/ccusage-cloud"
mkdir -p "$DIR"
curl -fsSL "$SERVER/cli.js" -o "$DIR/cli.js"
node "$DIR/cli.js" enroll --server "$SERVER" --code "$CODE"
node "$DIR/cli.js" sync
echo ""
echo "Done. To sync again later: node \\"$DIR/cli.js\\" sync"
echo "To automate, add that command to cron (Linux/macOS) or Task Scheduler (Windows)."
`;
}

function ps1Script(server: string, code: string): string {
  return `$ErrorActionPreference = 'Stop'
$Server = '${server}'
$Code = '${code}'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js >= 20 is required. Install it from https://nodejs.org (ccusage needs it too).'
  exit 1
}
$Dir = Join-Path $env:USERPROFILE '.config\\ccusage-cloud'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Cli = Join-Path $Dir 'cli.js'
Invoke-WebRequest -UseBasicParsing -Uri "$Server/cli.js" -OutFile $Cli
node $Cli enroll --server $Server --code $Code
node $Cli sync
Write-Host ""
Write-Host "Done. To sync again later: node `"$Cli`" sync"
Write-Host "To automate, register a Scheduled Task that runs that command."
`;
}

export const bootstrapRoutes = new Hono<AppBindings>();

bootstrapRoutes.get('/i.sh', (c) => {
  const code = c.req.query('c') ?? '';
  if (!CODE_RE.test(code)) return c.text('invalid code\n', 400);
  return c.text(shScript(new URL(c.req.url).origin, code));
});

bootstrapRoutes.get('/i.ps1', (c) => {
  const code = c.req.query('c') ?? '';
  if (!CODE_RE.test(code)) return c.text('invalid code\n', 400);
  return c.text(ps1Script(new URL(c.req.url).origin, code));
});
```

- [ ] **Step 4: Mount the routes**

In `worker/src/index.ts`, add the import:

```ts
import { bootstrapRoutes } from './bootstrap';
```

Then mount it **before** the `app.all('*', ...)` asset catch-all (so `/i.sh` and `/i.ps1` win), e.g. right after `app.route('/', readApiRoutes);`:

```ts
app.route('/', bootstrapRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ccusage-cloud/worker test bootstrap`
Expected: PASS.

- [ ] **Step 6: Run the full worker suite**

Run: `pnpm --filter @ccusage-cloud/worker test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add worker/src/bootstrap.ts worker/src/index.ts worker/test/bootstrap.test.ts
git commit -m "feat(worker): serve cross-platform bootstrap install scripts"
```

---

## Task 5: CLI — `enroll` command

**Files:**
- Create: `cli/src/enroll.ts`
- Modify: `cli/src/index.ts` (add `code` arg, `enroll` command, help text)
- Test: `cli/test/enroll.test.ts`

**Interfaces:**
- Consumes: `saveConfig` and `Config` from `./config`.
- Produces: `export async function enrollDevice(opts: EnrollOpts): Promise<{ token: string }>` where
  ```ts
  interface EnrollOpts {
    serverUrl: string;
    code: string;
    ccusageBin?: string;       // default 'ccusage'
    redactProjects?: boolean;  // default false
    label?: string;            // default os.hostname()
    fetchFn?: typeof fetch;    // default global fetch (for tests)
    configPath?: string;       // passed to saveConfig (for tests)
  }
  ```
  POSTs `{ code, label }` to `<serverUrl>/api/enroll`; on `410` throws `Error` with a "link expired" message; on other non-ok throws with status; on success writes config via `saveConfig` and returns `{ token }`.

- [ ] **Step 1: Write the failing test**

Create `cli/test/enroll.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { enrollDevice } from '../src/enroll';

function tmpConfig(): string {
  return join(mkdtempSync(join(tmpdir(), 'ccc-enroll-')), 'config.json');
}

describe('enrollDevice', () => {
  it('redeems a code, writes config, and defaults label to hostname', async () => {
    const configPath = tmpConfig();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: 'dev_1', token: 'cccloud_abc' }), { status: 200 }));
    const res = await enrollDevice({
      serverUrl: 'https://api.example.dev',
      code: 'ec_xyz',
      fetchFn: fetchFn as unknown as typeof fetch,
      configPath,
    });
    expect(res.token).toBe('cccloud_abc');

    const call = fetchFn.mock.calls[0];
    expect(String(call[0])).toBe('https://api.example.dev/api/enroll');
    const sentBody = JSON.parse((call[1] as RequestInit).body as string);
    expect(sentBody.code).toBe('ec_xyz');
    expect(sentBody.label).toBe(hostname());

    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(cfg).toMatchObject({ serverUrl: 'https://api.example.dev', token: 'cccloud_abc', ccusageBin: 'ccusage', redactProjects: false });
  });

  it('throws a clear message when the code is expired/used (410)', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 410 }));
    await expect(
      enrollDevice({ serverUrl: 'https://api.example.dev', code: 'ec_dead', fetchFn: fetchFn as unknown as typeof fetch, configPath: tmpConfig() }),
    ).rejects.toThrow(/expired or already used/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ccusage-cloud test enroll`
Expected: FAIL — cannot find `../src/enroll`.

- [ ] **Step 3: Create the enroll module**

Create `cli/src/enroll.ts`:

```ts
import { hostname } from 'node:os';
import { saveConfig, type Config } from './config';

export interface EnrollOpts {
  serverUrl: string;
  code: string;
  ccusageBin?: string;
  redactProjects?: boolean;
  label?: string;
  fetchFn?: typeof fetch;
  configPath?: string;
}

export async function enrollDevice(opts: EnrollOpts): Promise<{ token: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const label = opts.label ?? hostname();
  const res = await fetchFn(new URL('/api/enroll', opts.serverUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: opts.code, label }),
  });
  if (res.status === 410) {
    throw new Error('Enrollment link expired or already used. Generate a new one in the dashboard.');
  }
  if (!res.ok) {
    throw new Error(`Enrollment failed: ${res.status} ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  const cfg: Config = {
    serverUrl: opts.serverUrl,
    token,
    ccusageBin: opts.ccusageBin ?? 'ccusage',
    redactProjects: opts.redactProjects ?? false,
  };
  saveConfig(cfg, opts.configPath);
  return { token };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ccusage-cloud test enroll`
Expected: PASS.

- [ ] **Step 5: Wire the command into the CLI**

In `cli/src/index.ts`:

(a) Add `code` to the `parseArgs` options block (next to `token`):

```ts
        code: { type: 'string' },
```

(b) Add the `enroll` command handler. Place it right after the `login` block:

```ts
  if (cmd === 'enroll') {
    if (!values.server || !values.code) {
      console.error('enroll requires --server <url> and --code <code>');
      return 1;
    }
    const { enrollDevice } = await import('./enroll');
    try {
      await enrollDevice({
        serverUrl: values.server,
        code: values.code,
        ccusageBin: values['ccusage-bin'],
        redactProjects: values['redact-projects'] ?? false,
      });
    } catch (err) {
      console.error((err as Error).message);
      return 1;
    }
    console.log('Enrolled this device.');
    return 0;
  }
```

(c) Update the `HELP` string: add `enroll` under Commands and a line under Options:

```
  enroll   Redeem a one-time enroll code from the dashboard
```
```
  --code <code>       One-time enroll code (enroll)
```

- [ ] **Step 6: Run the full CLI suite**

Run: `pnpm --filter ccusage-cloud test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add cli/src/enroll.ts cli/src/index.ts cli/test/enroll.test.ts
git commit -m "feat(cli): add enroll command to redeem a one-time code"
```

---

## Task 6: CLI — single-file bundle served as `/cli.js`

**Files:**
- Modify: `cli/package.json` (add `build:bundle` script)
- Modify: `.gitignore` (ignore generated `dashboard/public/cli.js`)

**Interfaces:**
- Produces: `cli/bundle/index.js` — a single self-contained ESM file (no code-splitting; dynamic `import('./sync')` and `import('./enroll')` inlined). Copied to `dashboard/public/cli.js`, which `astro build` emits to `dashboard/dist/cli.js`, served by the Worker's `ASSETS` binding at `/cli.js`. Running `node cli/bundle/index.js <command>` behaves like the installed CLI (the existing `import.meta.url === process.argv[1]` self-run guard in `cli/src/index.ts` fires when invoked as `node <file>`).

- [ ] **Step 1: Add the bundle build script**

In `cli/package.json`, add to `scripts` (the inline copy is CommonJS, valid under `node -e` regardless of `"type": "module"`):

```json
    "build:bundle": "tsup src/index.ts --format esm --no-splitting --minify --out-dir bundle --clean && node -e \"require('fs').mkdirSync('../dashboard/public',{recursive:true});require('fs').copyFileSync('bundle/index.js','../dashboard/public/cli.js')\"",
```

- [ ] **Step 2: Ignore the generated artifacts**

Append to `.gitignore`:

```
cli/bundle
dashboard/public/cli.js
```

- [ ] **Step 3: Build the bundle**

Run: `pnpm --filter ccusage-cloud build:bundle`
Expected: creates `cli/bundle/index.js` and `dashboard/public/cli.js`, exit 0.

- [ ] **Step 4: Smoke-test the bundle is self-contained and runnable**

Run: `node cli/bundle/index.js --help`
Expected: prints the help text (including the `enroll` and `sync` commands) and exits 0. This proves the single file runs with no sibling chunks.

- [ ] **Step 5: Verify the copied asset exists**

Run: `node -e "process.exit(require('fs').existsSync('dashboard/public/cli.js')?0:1)"`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add cli/package.json .gitignore
git commit -m "build(cli): produce single-file bundle served as /cli.js"
```

---

## Task 7: Dashboard — install-command helper + enroll API client

**Files:**
- Create: `dashboard/src/lib/install.ts`
- Modify: `dashboard/src/lib/api.ts` (add `createEnrollLink`)
- Modify: `dashboard/src/lib/types.ts` (add `EnrollCode`)
- Test: `dashboard/src/lib/install.test.ts`

**Interfaces:**
- Produces:
  - `export function buildInstallCommands(origin: string, code: string): { sh: string; ps1: string }`
  - `export interface EnrollCode { code: string; expiresAt: number }` (in `types.ts`)
  - `export async function createEnrollLink(): Promise<EnrollCode>` (in `api.ts`) — `POST /api/enroll-codes`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/install.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildInstallCommands } from './install';

describe('buildInstallCommands', () => {
  it('builds curl and PowerShell one-liners from origin + code', () => {
    const { sh, ps1 } = buildInstallCommands('https://ccusage.example.dev', 'ec_abc123');
    expect(sh).toBe('curl -fsSL "https://ccusage.example.dev/i.sh?c=ec_abc123" | sh');
    expect(ps1).toBe('irm "https://ccusage.example.dev/i.ps1?c=ec_abc123" | iex');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter dashboard test install`
Expected: FAIL — cannot find `./install`.

- [ ] **Step 3: Create the helper**

Create `dashboard/src/lib/install.ts`:

```ts
export function buildInstallCommands(origin: string, code: string): { sh: string; ps1: string } {
  return {
    sh: `curl -fsSL "${origin}/i.sh?c=${code}" | sh`,
    ps1: `irm "${origin}/i.ps1?c=${code}" | iex`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter dashboard test install`
Expected: PASS.

- [ ] **Step 5: Add the API client + type**

In `dashboard/src/lib/types.ts`, add:

```ts
export interface EnrollCode { code: string; expiresAt: number }
```

In `dashboard/src/lib/api.ts`, add the import of the type and a new function (next to `createDevice`):

```ts
export async function createEnrollLink(): Promise<EnrollCode> {
  return json(await fetch('/api/enroll-codes', { ...base, method: 'POST', headers: jsonHeaders }));
}
```

Update the top-of-file type import to include `EnrollCode`:

```ts
import type { Me, Summary, SessionsPage, Filters, EnrollCode } from './types';
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/install.ts dashboard/src/lib/install.test.ts dashboard/src/lib/api.ts dashboard/src/lib/types.ts
git commit -m "feat(dashboard): enroll-link API client and install-command helper"
```

---

## Task 8: Dashboard — "Enroll a device" UI

**Files:**
- Modify: `dashboard/src/components/SettingsDevices.tsx`

**Interfaces:**
- Consumes: `createEnrollLink` from `@/lib/api`, `buildInstallCommands` from `@/lib/install`, `EnrollCode` from `@/lib/types`.
- Produces: a button in the Devices container that mints a code and renders both one-liners with an expiry note. No new exports.

- [ ] **Step 1: Add state, handler, and imports**

In `dashboard/src/components/SettingsDevices.tsx`:

(a) Extend the API import and add the helpers/types:

```ts
import { getMe, patchMe, createDevice, deleteDevice, logout, createEnrollLink } from '@/lib/api';
import { buildInstallCommands } from '@/lib/install';
import type { Me, DeviceInfo, EnrollCode } from '@/lib/types';
```

(b) Add state inside the component, next to the existing `useState` hooks:

```ts
  const [enroll, setEnroll] = useState<EnrollCode | null>(null);
```

(c) Add a handler next to `add()`:

```ts
  async function enrollLink() {
    setEnroll(await createEnrollLink());
  }
```

- [ ] **Step 2: Render the enroll UI**

In the Devices `Container`, add an enroll action and output below the existing "New device" `FormField` (still inside the same `SpaceBetween`). Use the page origin so the command targets this same Worker:

```tsx
              <FormField label="Enroll a new device with one command" description="Generates a one-time link (valid ~15 min) that registers the machine and syncs it.">
                <Button onClick={enrollLink}>Generate enroll command</Button>
              </FormField>
              {enroll && (
                <Alert type="info" header="Run one of these on the new machine">
                  <SpaceBetween size="xs">
                    <Box variant="awsui-key-label">Linux / macOS</Box>
                    <Box variant="code">{buildInstallCommands(window.location.origin, enroll.code).sh}</Box>
                    <Box variant="awsui-key-label">Windows (PowerShell)</Box>
                    <Box variant="code">{buildInstallCommands(window.location.origin, enroll.code).ps1}</Box>
                    <Box variant="small">Expires {new Date(enroll.expiresAt).toLocaleTimeString()} · single use.</Box>
                  </SpaceBetween>
                </Alert>
              )}
```

- [ ] **Step 3: Type-check the dashboard**

Run: `pnpm --filter dashboard check`
Expected: no type errors.

- [ ] **Step 4: Build the dashboard**

Run: `pnpm --filter dashboard build`
Expected: build succeeds (`dashboard/dist` produced).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/SettingsDevices.tsx
git commit -m "feat(dashboard): add one-command device enrollment UI"
```

---

## Task 9: Docs — README + deploy runbook

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOY.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Document the one-liner flow in the README**

In `README.md`, under Usage, add a section above the manual `login` instructions:

```markdown
### Quick enroll (recommended)

In the dashboard **Settings → Devices**, click **Generate enroll command** and run
the printed one-liner on the target machine:

```sh
# Linux / macOS
curl -fsSL "https://<your-worker>/i.sh?c=<code>" | sh
```
```powershell
# Windows (PowerShell)
irm "https://<your-worker>/i.ps1?c=<code>" | iex
```

The link is single-use and expires in ~15 minutes. It downloads the CLI from your
own Worker, registers the machine (named after its hostname), and runs one sync.
Re-run `node ~/.config/ccusage-cloud/cli.js sync` (or add it to cron / Task
Scheduler) to sync again. Node ≥ 20 and `ccusage` must be on `PATH`.

The manual `login --token` flow below remains available as a fallback.
```

- [ ] **Step 2: Document the build order in the deploy runbook**

In `docs/DEPLOY.md`, in **Step 3 — Build the dashboard** and in the **Re-deploying / updating** section, add the bundle build *before* the dashboard build so `/cli.js` ships:

```sh
pnpm --filter ccusage-cloud build:bundle   # emits dashboard/public/cli.js
pnpm --filter dashboard build
wrangler deploy
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/DEPLOY.md
git commit -m "docs: document one-command device enrollment and build order"
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

- [ ] **Build everything in deploy order**

```bash
pnpm --filter ccusage-cloud build:bundle
pnpm --filter dashboard build
```
Expected: both succeed; `dashboard/dist/cli.js` exists.

- [ ] **Manual end-to-end (post-deploy, optional but recommended)**

After `wrangler deploy`: in the dashboard, click **Generate enroll command**, run the
`sh` one-liner on a Linux machine with `ccusage` installed, and confirm the new
device (named after the hostname) appears in Settings and its sessions show up in the
dashboard. Re-running the same one-liner must fail with "link expired or already used".
```

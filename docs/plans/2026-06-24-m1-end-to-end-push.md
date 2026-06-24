# ccusage-cloud M1: End-to-End Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the full path — a real `ccusage claude session --json` run on a device lands as upserted rows in a Cloudflare D1 table, authenticated by a per-device token.

**Architecture:** A single Cloudflare Worker (Hono) exposes `POST /ingest`, authenticated by a per-device bearer token resolved to a `(user_id, device_id)` against D1. A small Node CLI (`ccusage-cloud`) shells out to vanilla `ccusage`, parses the session JSON, and pushes it. M1 covers the `claude` source only, full (non-incremental) push, and manual device enrollment via a seed script. No dashboard, no auth/magic-link, no incremental state — those are later milestones.

**Tech Stack:** TypeScript (strict), pnpm workspace, Hono v4, valibot v1, Cloudflare Workers + D1, wrangler v4, vitest + `@cloudflare/vitest-pool-workers`, Node 20 built-ins (`node:child_process`, `node:util parseArgs`, `node:crypto`).

## Global Constraints

- **Node** >= 20 (requires `node:util` `parseArgs`, `Buffer` `base64url`).
- **Package manager:** pnpm; two workspace packages: `worker/`, `cli/`.
- **TypeScript:** strict mode, ESM (`"type": "module"`), `moduleResolution: bundler`.
- **Worker runtime:** Hono v4, valibot v1, wrangler v4, `compatibility_date = "2025-01-01"`.
- **Device token format:** `cccloud_` + `base64url(32 random bytes)`. The server stores **only the lowercase-hex SHA-256** of the token (`token_sha256`), never the plaintext.
- **Upsert key (idempotency):** `(user_id, device_id, source, session_id)`.
- **M1 sources:** `['claude']` only. Other sources are added in M2.
- **ccusage JSON shape:** `ccusage <source> session --json` →
  `{ "sessions": [ { sessionId, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens, totalCost, credits?, firstActivity, lastActivity, modelsUsed, modelBreakdowns, projectPath } ], "totals": {...} }`.
  `sessionId`, `firstActivity`, `lastActivity`, `projectPath` may be `null`; rows with a `null` `sessionId` are skipped by the CLI.
- **Deployment:** custom domain only (no `workers.dev`). M1 development and tests run **locally** (`wrangler dev --local`, miniflare); the custom-domain binding is a deploy-time concern deferred to a later milestone.

## File Structure

```
ccusage-cloud/
  package.json                 # root, private, workspace
  pnpm-workspace.yaml
  tsconfig.base.json
  .gitignore
  worker/
    package.json
    wrangler.jsonc             # name, main, compat date, D1 binding
    tsconfig.json
    vitest.config.ts           # vitest-pool-workers + D1 migrations
    env.d.ts                   # cloudflare:test ProvidedEnv
    migrations/
      0001_init.sql            # users, allowed_emails, devices, sessions
    src/
      env.ts                   # Env, DeviceContext, AppBindings types
      crypto.ts                # sha256Hex (Web Crypto)
      schema.ts                # valibot ingest payload schema
      db.ts                    # upsertSessions
      auth.ts                  # deviceAuth middleware
      index.ts                 # Hono app: /health, /ingest
    test/
      apply-migrations.ts      # setup: applies D1 migrations
      seed.ts                  # test helper: seed user + device, return token
      health.test.ts
      migration.test.ts
      auth.test.ts
      ingest.test.ts
    scripts/
      seed-device.ts           # mint a device token into local D1 (manual enroll)
  cli/
    package.json
    tsconfig.json
    vitest.config.ts
    bin/
      ccusage-cloud.js         # shebang entry -> dist/index.js
    src/
      types.ts                 # SessionRow / TaggedSession + valibot
      config.ts                # load/save ~/.config/ccusage-cloud/config.json
      ccusage.ts               # run ccusage + parse sessions
      sync.ts                  # collect + POST /ingest
      index.ts                 # arg parsing / command dispatch
    test/
      config.test.ts
      ccusage.test.ts
      sync.test.ts
    fixtures/
      claude-session.json      # sample `ccusage claude session --json` output
```

---

## Task 1: Worker skeleton + workspace scaffolding

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `worker/package.json`, `worker/wrangler.jsonc`, `worker/tsconfig.json`, `worker/vitest.config.ts`, `worker/env.d.ts`
- Create: `worker/src/env.ts`, `worker/src/index.ts`
- Test: `worker/test/health.test.ts`

**Interfaces:**
- Produces: `Env` (`{ DB: D1Database }`), `DeviceContext` (`{ userId: string; deviceId: string }`), `AppBindings` (`{ Bindings: Env; Variables: { device: DeviceContext } }`) from `worker/src/env.ts`. The Hono app default-exported from `worker/src/index.ts`.

- [ ] **Step 1: Create root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - worker
  - cli
```

`package.json`:
```json
{
  "name": "ccusage-cloud-monorepo",
  "private": true,
  "type": "module"
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

`.gitignore`:
```
node_modules
dist
.wrangler
.dev.vars
*.log
```

- [ ] **Step 2: Create the worker package manifest and wrangler config**

`worker/package.json`:
```json
{
  "name": "@ccusage-cloud/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "migrate:local": "wrangler d1 migrations apply ccusage-cloud --local"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "valibot": "^1.0.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20250101.0",
    "wrangler": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`worker/wrangler.jsonc`:
```jsonc
{
  "name": "ccusage-cloud",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ccusage-cloud",
      "database_id": "local-dev-placeholder",
      "migrations_dir": "migrations"
    }
  ]
}
```

`worker/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test", "scripts", "env.d.ts"]
}
```

- [ ] **Step 3: Create the vitest pool-workers config and test type declaration**

`worker/vitest.config.ts`:
```ts
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            d1Databases: ['DB'],
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
```

`worker/env.d.ts`:
```ts
import type { Env } from './src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [ ] **Step 4: Create the shared types and the Hono app**

`worker/src/env.ts`:
```ts
export interface Env {
  DB: D1Database;
}

export interface DeviceContext {
  userId: string;
  deviceId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { device: DeviceContext };
};
```

`worker/src/index.ts`:
```ts
import { Hono } from 'hono';
import type { AppBindings } from './env';

const app = new Hono<AppBindings>();

app.get('/health', (c) => c.json({ ok: true }));

export default app;
```

- [ ] **Step 5: Write the failing health test**

`worker/test/health.test.ts`:
```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

Also create a placeholder `worker/test/apply-migrations.ts` so the setup file resolves (filled in Task 2):
```ts
// Migrations are applied in Task 2. Placeholder for setupFiles resolution.
export {};
```

- [ ] **Step 6: Install and run the test to verify it passes**

Run:
```bash
pnpm install
pnpm --filter @ccusage-cloud/worker test
```
Expected: `health.test.ts` PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(worker): Hono skeleton with /health and pool-workers test setup"
```

---

## Task 2: D1 schema + migration

**Files:**
- Create: `worker/migrations/0001_init.sql`
- Modify: `worker/test/apply-migrations.ts`
- Test: `worker/test/migration.test.ts`

**Interfaces:**
- Produces: tables `users`, `allowed_emails`, `devices`, `sessions` with the columns referenced by Tasks 3–4. `sessions` primary key is `(user_id, device_id, source, session_id)`.

- [ ] **Step 1: Write the migration**

`worker/migrations/0001_init.sql`:
```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  public_to_group INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE allowed_emails (
  email    TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_sha256 TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX idx_devices_user ON devices(user_id);

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
  project_path          TEXT,
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, source, session_id)
);
CREATE INDEX idx_sessions_user_activity ON sessions(user_id, last_activity);
```

- [ ] **Step 2: Apply migrations in the test setup**

Replace `worker/test/apply-migrations.ts`:
```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 3: Write the failing migration test**

`worker/test/migration.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('migration 0001', () => {
  it('creates the expected tables', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['allowed_emails', 'devices', 'sessions', 'users']),
    );
  });

  it('enforces the sessions composite primary key', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(sessions)').all<{ name: string; pk: number }>();
    const pkCols = cols.results.filter((c) => c.pk > 0).map((c) => c.name);
    expect(pkCols).toEqual(
      expect.arrayContaining(['user_id', 'device_id', 'source', 'session_id']),
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
pnpm --filter @ccusage-cloud/worker test migration
```
Expected: 2 tests PASS. (If `applyD1Migrations` errors, the migration SQL is invalid — fix and rerun.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(worker): D1 schema migration (users, devices, sessions)"
```

---

## Task 3: Device token auth middleware

**Files:**
- Create: `worker/src/crypto.ts`, `worker/src/auth.ts`
- Create: `worker/test/seed.ts`
- Test: `worker/test/auth.test.ts`
- Modify: `worker/src/index.ts` (mount a temporary guarded route for the test)

**Interfaces:**
- Consumes: `AppBindings`, `DeviceContext` from `env.ts`; `devices`/`users` tables.
- Produces: `sha256Hex(input: string): Promise<string>` from `crypto.ts`; `deviceAuth` Hono middleware from `auth.ts` that sets `c.var.device` (a `DeviceContext`) or responds `401`. `seedDevice(env, email, label?)` test helper returning `{ token, userId, deviceId }`.

- [ ] **Step 1: Implement the SHA-256 helper**

`worker/src/crypto.ts`:
```ts
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 2: Implement the auth middleware**

`worker/src/auth.ts`:
```ts
import { createMiddleware } from 'hono/factory';
import type { AppBindings } from './env';
import { sha256Hex } from './crypto';

export const deviceAuth = createMiddleware<AppBindings>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing token' }, 401);
  }
  const tokenHash = await sha256Hex(header.slice('Bearer '.length));
  const row = await c.env.DB.prepare(
    'SELECT id, user_id FROM devices WHERE token_sha256 = ? AND revoked_at IS NULL',
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: string }>();
  if (!row) {
    return c.json({ error: 'invalid token' }, 401);
  }
  c.set('device', { userId: row.user_id, deviceId: row.id });
  await next();
});
```

- [ ] **Step 3: Create the test seed helper**

`worker/test/seed.ts`:
```ts
import { sha256Hex } from '../src/crypto';
import type { Env } from '../src/env';

let counter = 0;

export async function seedDevice(
  env: Env,
  email = `user${counter}@example.com`,
  label = 'test-device',
): Promise<{ token: string; userId: string; deviceId: string }> {
  counter += 1;
  const token = `cccloud_test_${counter}`;
  const tokenHash = await sha256Hex(token);
  const userId = `usr_${counter}`;
  const deviceId = `dev_${counter}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO allowed_emails (email, added_at) VALUES (?, ?)').bind(email, now),
    env.DB
      .prepare('INSERT INTO users (id, email, public_to_group, created_at) VALUES (?, ?, 0, ?)')
      .bind(userId, email, now),
    env.DB
      .prepare(
        'INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(deviceId, userId, tokenHash, label, now),
  ]);
  return { token, userId, deviceId };
}
```

- [ ] **Step 4: Mount a temporary guarded route**

Modify `worker/src/index.ts` to add (above `export default app;`):
```ts
import { deviceAuth } from './auth';

app.get('/_whoami', deviceAuth, (c) => c.json(c.var.device));
```

- [ ] **Step 5: Write the failing auth test**

`worker/test/auth.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedDevice } from './seed';

describe('deviceAuth', () => {
  it('rejects a request with no token', async () => {
    const res = await SELF.fetch('https://example.com/_whoami');
    expect(res.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const res = await SELF.fetch('https://example.com/_whoami', {
      headers: { Authorization: 'Bearer cccloud_nope' },
    });
    expect(res.status).toBe(401);
  });

  it('resolves a seeded device to its user', async () => {
    const { token, userId, deviceId } = await seedDevice(env);
    const res = await SELF.fetch('https://example.com/_whoami', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId, deviceId });
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```bash
pnpm --filter @ccusage-cloud/worker test auth
```
Expected: 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(worker): per-device bearer token auth middleware"
```

---

## Task 4: `POST /ingest` with idempotent upsert

**Files:**
- Create: `worker/src/schema.ts`, `worker/src/db.ts`
- Modify: `worker/src/index.ts` (add `/ingest`, remove the temporary `/_whoami`)
- Test: `worker/test/ingest.test.ts`

**Interfaces:**
- Consumes: `deviceAuth`, `AppBindings`, `seedDevice`.
- Produces: `IngestSchema` + `SessionPayload` from `schema.ts`; `upsertSessions(db: D1Database, userId: string, deviceId: string, sessions: SessionPayload[]): Promise<number>` from `db.ts`. Endpoint `POST /ingest` returning `{ upserted: number, skipped: number }`.

- [ ] **Step 1: Define the valibot ingest schema**

`worker/src/schema.ts`:
```ts
import * as v from 'valibot';

export const SessionSchema = v.object({
  source: v.string(),
  sessionId: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationTokens: v.number(),
  cacheReadTokens: v.number(),
  totalTokens: v.number(),
  totalCost: v.number(),
  credits: v.optional(v.number()),
  firstActivity: v.nullish(v.string()),
  lastActivity: v.nullish(v.string()),
  modelsUsed: v.optional(v.array(v.string()), []),
  modelBreakdowns: v.optional(v.unknown()),
  projectPath: v.nullish(v.string()),
});

export const IngestSchema = v.object({
  sessions: v.array(SessionSchema),
});

export type SessionPayload = v.InferOutput<typeof SessionSchema>;
```

- [ ] **Step 2: Implement the upsert**

`worker/src/db.ts`:
```ts
import type { SessionPayload } from './schema';

const UPSERT = `
INSERT INTO sessions (
  user_id, device_id, source, session_id,
  input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
  total_tokens, total_cost, credits, first_activity, last_activity,
  models_used, model_breakdowns, project_path, updated_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT (user_id, device_id, source, session_id) DO UPDATE SET
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
  project_path          = excluded.project_path,
  updated_at            = excluded.updated_at
`;

export async function upsertSessions(
  db: D1Database,
  userId: string,
  deviceId: string,
  sessions: SessionPayload[],
): Promise<number> {
  if (sessions.length === 0) return 0;
  const now = Date.now();
  const stmt = db.prepare(UPSERT);
  const batch = sessions.map((s) =>
    stmt.bind(
      userId,
      deviceId,
      s.source,
      s.sessionId,
      s.inputTokens,
      s.outputTokens,
      s.cacheCreationTokens,
      s.cacheReadTokens,
      s.totalTokens,
      s.totalCost,
      s.credits ?? null,
      s.firstActivity ?? null,
      s.lastActivity ?? null,
      JSON.stringify(s.modelsUsed),
      JSON.stringify(s.modelBreakdowns ?? null),
      s.projectPath ?? null,
      now,
    ),
  );
  await db.batch(batch);
  return sessions.length;
}
```

- [ ] **Step 3: Wire the endpoint and remove the temporary route**

Replace `worker/src/index.ts` with:
```ts
import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { deviceAuth } from './auth';
import { IngestSchema } from './schema';
import { upsertSessions } from './db';

const app = new Hono<AppBindings>();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/ingest', deviceAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(IngestSchema, body);
  if (!parsed.success) {
    return c.json({ error: 'invalid payload' }, 400);
  }
  const { userId, deviceId } = c.var.device;
  const upserted = await upsertSessions(c.env.DB, userId, deviceId, parsed.output.sessions);
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?')
    .bind(Date.now(), deviceId)
    .run();
  return c.json({ upserted, skipped: 0 });
});

export default app;
```

- [ ] **Step 4: Write the failing ingest tests**

`worker/test/ingest.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedDevice } from './seed';

function session(overrides: Record<string, unknown> = {}) {
  return {
    source: 'claude',
    sessionId: 's1',
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 30,
    totalCost: 0.5,
    firstActivity: '2026-06-01T00:00:00Z',
    lastActivity: '2026-06-01T01:00:00Z',
    modelsUsed: ['claude-opus-4-8'],
    modelBreakdowns: [{ model: 'claude-opus-4-8', cost: 0.5 }],
    projectPath: '/home/me/proj',
    ...overrides,
  };
}

async function post(token: string, sessions: unknown[]) {
  return SELF.fetch('https://example.com/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessions }),
  });
}

describe('POST /ingest', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed payload', async () => {
    const { token } = await seedDevice(env);
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessions: [{ sessionId: 's1' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('inserts a session row scoped to the device user', async () => {
    const { token, userId, deviceId } = await seedDevice(env);
    const res = await post(token, [session()]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 1, skipped: 0 });

    const row = await env.DB.prepare(
      'SELECT total_cost FROM sessions WHERE user_id=? AND device_id=? AND source=? AND session_id=?',
    )
      .bind(userId, deviceId, 'claude', 's1')
      .first<{ total_cost: number }>();
    expect(row?.total_cost).toBe(0.5);
  });

  it('is idempotent: re-pushing updates, does not duplicate', async () => {
    const { token, userId } = await seedDevice(env);
    await post(token, [session({ totalCost: 0.5 })]);
    await post(token, [session({ totalCost: 1.25 })]);

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND session_id=?',
    )
      .bind(userId, 's1')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const row = await env.DB.prepare(
      'SELECT total_cost FROM sessions WHERE user_id=? AND session_id=?',
    )
      .bind(userId, 's1')
      .first<{ total_cost: number }>();
    expect(row?.total_cost).toBe(1.25);
  });

  it('updates the device last_seen_at', async () => {
    const { token, deviceId } = await seedDevice(env);
    await post(token, [session()]);
    const row = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id=?')
      .bind(deviceId)
      .first<{ last_seen_at: number | null }>();
    expect(row?.last_seen_at).not.toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
pnpm --filter @ccusage-cloud/worker test ingest
```
Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(worker): POST /ingest with idempotent session upsert"
```

---

## Task 5: Device enrollment seed script (manual)

**Files:**
- Create: `worker/scripts/seed-device.ts`
- Modify: `worker/package.json` (add `seed:device` script)

**Interfaces:**
- Produces: a runnable script that inserts an allowed email + user + device into the **local** D1 and prints a device token once. Used for manual enrollment in Task 9 and real-world M1 use. (Dev-only; the dashboard "Add device" flow replaces it in M3.)

- [ ] **Step 1: Write the seed script**

`worker/scripts/seed-device.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const email = process.argv[2];
const label = process.argv[3] ?? 'cli-device';
if (!email) {
  console.error('Usage: tsx scripts/seed-device.ts <email> [label]');
  process.exit(1);
}

const token = `cccloud_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
const userId = `usr_${randomBytes(12).toString('hex')}`;
const deviceId = `dev_${randomBytes(12).toString('hex')}`;
const now = Date.now();

// Dev-only seeding into the LOCAL D1. Values are generated here (no user input
// is interpolated beyond the email/label arguments you control).
const sql = `
INSERT INTO allowed_emails (email, added_at) VALUES ('${email}', ${now})
  ON CONFLICT(email) DO NOTHING;
INSERT INTO users (id, email, public_to_group, created_at) VALUES ('${userId}', '${email}', 0, ${now})
  ON CONFLICT(email) DO NOTHING;
INSERT INTO devices (id, user_id, token_sha256, label, created_at)
  SELECT '${deviceId}', id, '${tokenHash}', '${label}', ${now} FROM users WHERE email = '${email}';
`;

execFileSync('wrangler', ['d1', 'execute', 'ccusage-cloud', '--local', '--command', sql], {
  stdio: 'inherit',
});

console.log(`\nDevice enrolled for ${email}.`);
console.log(`Device token (shown once — store securely):\n\n  ${token}\n`);
```

- [ ] **Step 2: Add the package script and a dev dependency**

In `worker/package.json`, add to `"scripts"`:
```json
    "seed:device": "tsx scripts/seed-device.ts"
```
and add to `"devDependencies"`:
```json
    "tsx": "^4.19.0"
```
Then:
```bash
pnpm install
```

- [ ] **Step 3: Smoke-run against local D1**

Run (creates local D1 state, applies migrations, seeds):
```bash
pnpm --filter @ccusage-cloud/worker migrate:local
pnpm --filter @ccusage-cloud/worker seed:device me@example.com laptop
```
Expected: prints `Device enrolled for me@example.com.` and a `cccloud_...` token. (Save the token for Task 9.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(worker): local device enrollment seed script"
```

---

## Task 6: CLI skeleton + config

**Files:**
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/vitest.config.ts`, `cli/bin/ccusage-cloud.js`
- Create: `cli/src/config.ts`, `cli/src/index.ts`
- Test: `cli/test/config.test.ts`

**Interfaces:**
- Produces: `Config` (`{ serverUrl: string; token: string; ccusageBin: string }`), `configPath()`, `loadConfig(path?)`, `saveConfig(cfg, path?)` from `config.ts`. CLI entry dispatching `login` and `sync` (sync wired in Task 8).

- [ ] **Step 1: Create the CLI package manifest**

`cli/package.json`:
```json
{
  "name": "ccusage-cloud",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "ccusage-cloud": "bin/ccusage-cloud.js" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --out-dir dist --clean",
    "test": "vitest run"
  },
  "dependencies": {
    "valibot": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`cli/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src", "bin", "test"]
}
```

`cli/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

`cli/bin/ccusage-cloud.js`:
```js
#!/usr/bin/env node
import '../dist/index.js';
```

- [ ] **Step 2: Implement config load/save**

`cli/src/config.ts`:
```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  serverUrl: string;
  token: string;
  ccusageBin: string;
}

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'ccusage-cloud', 'config.json');
}

export function loadConfig(path = configPath()): Config | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Config;
}

export function saveConfig(cfg: Config, path = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
  chmodSync(path, 0o600);
}
```

- [ ] **Step 3: Implement the command dispatcher (login only for now)**

`cli/src/index.ts`:
```ts
import { parseArgs } from 'node:util';
import { loadConfig, saveConfig } from './config';

const M1_SOURCES = ['claude'];

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      token: { type: 'string' },
      server: { type: 'string' },
      'ccusage-bin': { type: 'string' },
    },
  });
  const cmd = positionals[0];

  if (cmd === 'login') {
    if (!values.server || !values.token) {
      console.error('login requires --server <url> and --token <token>');
      return 1;
    }
    saveConfig({
      serverUrl: values.server,
      token: values.token,
      ccusageBin: values['ccusage-bin'] ?? 'ccusage',
    });
    console.log('Saved credentials.');
    return 0;
  }

  if (cmd === 'sync') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('Not logged in. Run `ccusage-cloud login --server <url> --token <token>`.');
      return 1;
    }
    // Wired in Task 8.
    const { syncOnce } = await import('./sync');
    const { pushed } = await syncOnce(cfg, M1_SOURCES);
    console.log(`Pushed ${pushed} sessions.`);
    return 0;
  }

  console.error('Usage: ccusage-cloud <login|sync>');
  return 1;
}

run(process.argv.slice(2)).then((code) => process.exit(code));
```

> Note: `./sync` is created in Task 8. Until then, `cli` will typecheck only after Task 8. The config test below does not import `index.ts`, so it passes now.

- [ ] **Step 4: Write the failing config test**

`cli/test/config.test.ts`:
```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, saveConfig, type Config } from '../src/config';

describe('config', () => {
  it('round-trips a saved config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccusage-cloud-'));
    const path = join(dir, 'config.json');
    const cfg: Config = { serverUrl: 'https://x.dev', token: 'cccloud_abc', ccusageBin: 'ccusage' };

    saveConfig(cfg, path);
    expect(loadConfig(path)).toEqual(cfg);
    expect(readFileSync(path, 'utf8')).toContain('cccloud_abc');
  });

  it('returns null when no config exists', () => {
    expect(loadConfig(join(tmpdir(), 'does-not-exist-xyz', 'config.json'))).toBeNull();
  });
});
```

- [ ] **Step 5: Install and run the test to verify it passes**

Run:
```bash
pnpm install
pnpm --filter ccusage-cloud test config
```
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): skeleton with login command and config persistence"
```

---

## Task 7: CLI ccusage runner + parser

**Files:**
- Create: `cli/src/types.ts`, `cli/src/ccusage.ts`
- Create: `cli/fixtures/claude-session.json`
- Test: `cli/test/ccusage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TaggedSession` type and `loadSessions(source: string, bin: string, run?: Runner): TaggedSession[]` from `ccusage.ts`; `Runner = (bin: string, args: string[]) => string`. A `TaggedSession` is the parsed session plus `source: string`, with a non-null `sessionId: string`. The object shape matches `SessionSchema` (worker) field-for-field so it serializes directly into the ingest payload.

- [ ] **Step 1: Define the session types**

`cli/src/types.ts`:
```ts
import * as v from 'valibot';

export const SessionRowSchema = v.object({
  sessionId: v.nullable(v.string()),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationTokens: v.number(),
  cacheReadTokens: v.number(),
  totalTokens: v.number(),
  totalCost: v.number(),
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

export type TaggedSession = Omit<SessionRow, 'sessionId'> & {
  source: string;
  sessionId: string;
};
```

- [ ] **Step 2: Create a fixture from real output shape**

`cli/fixtures/claude-session.json`:
```json
{
  "sessions": [
    {
      "sessionId": "sess-aaa",
      "inputTokens": 1000,
      "outputTokens": 2000,
      "cacheCreationTokens": 50,
      "cacheReadTokens": 300,
      "totalTokens": 3350,
      "totalCost": 0.42,
      "firstActivity": "2026-06-20T10:00:00Z",
      "lastActivity": "2026-06-20T12:30:00Z",
      "modelsUsed": ["claude-opus-4-8"],
      "modelBreakdowns": [{ "modelName": "claude-opus-4-8", "cost": 0.42 }],
      "projectPath": "/home/me/work/app"
    },
    {
      "sessionId": null,
      "inputTokens": 5,
      "outputTokens": 5,
      "cacheCreationTokens": 0,
      "cacheReadTokens": 0,
      "totalTokens": 10,
      "totalCost": 0.0,
      "firstActivity": null,
      "lastActivity": null,
      "modelsUsed": [],
      "modelBreakdowns": [],
      "projectPath": null
    }
  ],
  "totals": { "totalCost": 0.42 }
}
```

- [ ] **Step 3: Implement the runner + parser**

`cli/src/ccusage.ts`:
```ts
import { execFileSync } from 'node:child_process';
import * as v from 'valibot';
import { SessionFileSchema, type TaggedSession } from './types';

export type Runner = (bin: string, args: string[]) => string;

const defaultRunner: Runner = (bin, args) =>
  execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

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

  const parsed = v.safeParse(SessionFileSchema, json);
  if (!parsed.success) return [];

  return parsed.output.sessions
    .filter((s): s is typeof s & { sessionId: string } => s.sessionId !== null)
    .map(({ sessionId, ...rest }) => ({ ...rest, sessionId, source }));
}
```

- [ ] **Step 4: Write the failing parser test**

`cli/test/ccusage.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSessions, type Runner } from '../src/ccusage';

const fixture = readFileSync(join(__dirname, '../fixtures/claude-session.json'), 'utf8');

describe('loadSessions', () => {
  it('parses, tags source, and drops null sessionId rows', () => {
    const run: Runner = () => fixture;
    const out = loadSessions('claude', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'claude',
      sessionId: 'sess-aaa',
      totalCost: 0.42,
      projectPath: '/home/me/work/app',
    });
  });

  it('passes the right ccusage args', () => {
    const calls: string[][] = [];
    const run: Runner = (_bin, args) => {
      calls.push(args);
      return fixture;
    };
    loadSessions('claude', 'ccusage', run);
    expect(calls[0]).toEqual(['claude', 'session', '--json']);
  });

  it('returns [] when the runner throws (source missing)', () => {
    const run: Runner = () => {
      throw new Error('command not found');
    };
    expect(loadSessions('claude', 'ccusage', run)).toEqual([]);
  });

  it('returns [] on non-JSON output', () => {
    const run: Runner = () => 'not json';
    expect(loadSessions('claude', 'ccusage', run)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
pnpm --filter ccusage-cloud test ccusage
```
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): run ccusage and parse session JSON into tagged sessions"
```

---

## Task 8: CLI sync (collect + push)

**Files:**
- Create: `cli/src/sync.ts`
- Test: `cli/test/sync.test.ts`

**Interfaces:**
- Consumes: `Config` from `config.ts`; `loadSessions`, `Runner`, `TaggedSession` from `ccusage.ts`/`types.ts`.
- Produces: `syncOnce(cfg: Config, sources: string[], run?: Runner, fetchFn?: typeof fetch): Promise<{ pushed: number }>` from `sync.ts`. Posts `{ sessions: TaggedSession[] }` to `<serverUrl>/ingest` with `Authorization: Bearer <token>`.

- [ ] **Step 1: Implement sync**

`cli/src/sync.ts`:
```ts
import type { Config } from './config';
import { loadSessions, type Runner } from './ccusage';
import type { TaggedSession } from './types';

export async function syncOnce(
  cfg: Config,
  sources: string[],
  run?: Runner,
  fetchFn: typeof fetch = fetch,
): Promise<{ pushed: number }> {
  const sessions: TaggedSession[] = [];
  for (const source of sources) {
    sessions.push(...loadSessions(source, cfg.ccusageBin, run));
  }
  if (sessions.length === 0) return { pushed: 0 };

  const res = await fetchFn(new URL('/ingest', cfg.serverUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ sessions }),
  });

  if (!res.ok) {
    throw new Error(`ingest failed: ${res.status} ${await res.text()}`);
  }
  return { pushed: sessions.length };
}
```

- [ ] **Step 2: Write the failing sync test**

`cli/test/sync.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { syncOnce } from '../src/sync';
import type { Runner } from '../src/ccusage';
import type { Config } from '../src/config';

const fixture = readFileSync(join(__dirname, '../fixtures/claude-session.json'), 'utf8');
const cfg: Config = { serverUrl: 'https://api.example.dev', token: 'cccloud_xyz', ccusageBin: 'ccusage' };
const run: Runner = () => fixture;

describe('syncOnce', () => {
  it('posts tagged sessions to /ingest with the bearer token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ upserted: 1, skipped: 0 }), { status: 200 }));

    const result = await syncOnce(cfg, ['claude'], run, fetchFn as unknown as typeof fetch);

    expect(result).toEqual({ pushed: 1 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.dev/ingest');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer cccloud_xyz');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].source).toBe('claude');
  });

  it('does not call fetch when there are no sessions', async () => {
    const fetchFn = vi.fn();
    const empty: Runner = () => '{"sessions":[],"totals":{}}';
    const result = await syncOnce(cfg, ['claude'], empty, fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ pushed: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws when the server responds non-2xx', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(syncOnce(cfg, ['claude'], run, fetchFn as unknown as typeof fetch)).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run:
```bash
pnpm --filter ccusage-cloud test sync
```
Expected: 3 tests PASS.

- [ ] **Step 4: Verify the whole CLI package typechecks and builds**

Run:
```bash
pnpm --filter ccusage-cloud exec tsc --noEmit
pnpm --filter ccusage-cloud build
```
Expected: no type errors; `cli/dist/index.js` produced.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cli): sync command collects sessions and pushes to /ingest"
```

---

## Task 9: Manual end-to-end verification

**Files:** none (verification task). Produces a documented smoke test proving CLI → Worker → D1 with real `ccusage` output.

> A fully-automated cross-runtime e2e (Node CLI ↔ workerd) is deferred to M2,
> which adds `wrangler unstable_dev`-based integration. M1 verifies the seam
> manually; both halves (CLI push, Worker ingest) are already unit-tested.

- [ ] **Step 1: Start the Worker locally with the seeded device**

In `worker/` (reusing the local D1 + token from Task 5):
```bash
pnpm --filter @ccusage-cloud/worker dev
```
Leave it running (default `http://localhost:8787`). Confirm health:
```bash
curl -s http://localhost:8787/health
```
Expected: `{"ok":true}`.

- [ ] **Step 2: Log the CLI in against the local Worker**

Use the `cccloud_...` token printed in Task 5:
```bash
node cli/dist/index.js login \
  --server http://localhost:8787 \
  --token cccloud_PASTE_FROM_TASK_5 \
  --ccusage-bin ccusage
```
Expected: `Saved credentials.`

- [ ] **Step 3: Run a real sync**

```bash
node cli/dist/index.js sync
```
Expected: `Pushed N sessions.` (N = your local Claude session count). If you have no Claude data, point `--ccusage-bin` at a script echoing the fixture:
```bash
printf '#!/usr/bin/env bash\ncat %s\n' "$PWD/cli/fixtures/claude-session.json" > /tmp/fake-ccusage
chmod +x /tmp/fake-ccusage
node cli/dist/index.js login --server http://localhost:8787 --token cccloud_PASTE --ccusage-bin /tmp/fake-ccusage
node cli/dist/index.js sync   # Expected: Pushed 1 sessions.
```

- [ ] **Step 4: Confirm rows landed in D1**

```bash
wrangler d1 execute ccusage-cloud --local \
  --command "SELECT source, session_id, total_cost FROM sessions"
```
Expected: at least one row (e.g. `claude | sess-aaa | 0.42`).

- [ ] **Step 5: Confirm idempotency**

Re-run the sync, then re-count:
```bash
node cli/dist/index.js sync
wrangler d1 execute ccusage-cloud --local --command "SELECT COUNT(*) AS n FROM sessions"
```
Expected: the count is unchanged from Step 4 (rows updated, not duplicated).

- [ ] **Step 6: Record the result**

Append a short note to the PR/commit description confirming Steps 4–5 output. No code commit required for this task.

---

## Self-Review

**Spec coverage (M1 scope):**
- Worker + D1 schema → Tasks 1, 2. ✓
- `POST /ingest` + idempotent upsert on `(user_id, device_id, source, session_id)` → Task 4. ✓
- Per-device bearer token auth, account resolved server-side → Task 3. ✓
- Manual device enrollment (seed row, token shown once) → Task 5. ✓
- Sync CLI MVP, `claude` source only, shells out to vanilla ccusage → Tasks 6–8. ✓
- Prove a session row lands in D1 → Task 9. ✓
- Out of M1 scope (correctly absent): magic-link auth, dashboard, incremental `state.json`, multi-source, group view, redaction — these belong to M2–M4.

**Type consistency:**
- `Env` / `DeviceContext` / `AppBindings` defined in Task 1, consumed unchanged in Tasks 3–4. ✓
- `SessionPayload` (worker `schema.ts`, Task 4) and `TaggedSession` (cli `types.ts`, Task 7) share the same field names so a `TaggedSession` JSON-serializes straight into `IngestSchema`. ✓
- `loadSessions(source, bin, run?)` signature defined in Task 7, used identically in Task 8. ✓
- `syncOnce(cfg, sources, run?, fetchFn?)` defined in Task 8, referenced by the Task 6 dispatcher via dynamic import. ✓
- `upsertSessions(db, userId, deviceId, sessions)` defined and used in Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; Task 9 is an explicit manual-verification task with exact commands, not a vague stub. The one forward reference (`./sync` imported in Task 6 before Task 8 creates it) is called out inline with the reason the config test still passes.

## Open follow-ups for M2 (not in this plan)

- Incremental `state.json` (hash per session) + `--full`.
- All sources + per-source skip.
- Chunking (500 sessions/request) + retry/backoff.
- Automated cross-process e2e via `wrangler unstable_dev`.
- Magic-link viewer auth + device-management API.

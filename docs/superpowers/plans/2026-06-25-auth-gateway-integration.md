# Replace Magic Links with auth-gateway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the email Magic Link viewer sign-in with auth-gateway SSO, verifying EdDSA JWTs offline via the managed `auth-verify` package.

**Architecture:** A new `requireUser` Hono middleware wraps `auth-verify`'s `requireUser(request, config)`, reading the `__Secure-fleet_at` cookie or a Bearer token, verifying it against the gateway JWKS, and auto-provisioning a `users` row keyed by the gateway `sub`. All magic-link machinery (routes, email, login-token + viewer-session KV, interstitial, `allowed_emails`) is removed. The dashboard redirects to the gateway `/authorize` on 401 and logs out via the gateway. Device-token (CLI) auth is untouched.

**Tech Stack:** Cloudflare Workers, Hono, valibot, D1, `auth-verify` (`github:echung32/auth-verify#v1`), `jose` (peer dep), Astro + React + Cloudscape dashboard, Vitest (`@cloudflare/vitest-pool-workers` for the worker, jsdom for the dashboard).

## Global Constraints

- Gateway constants (verbatim): `jwksUrl: https://auth.ethanchung.dev/.well-known/jwks.json`, `issuer: https://auth.ethanchung.dev`, `audience: fleet`.
- `users.id` = gateway `sub` (e.g. `gh|<github-id>`). `email` and `name` are nullable.
- Authorization is **trust-the-gateway**: any valid `fleet`-audience token is allowed; no local allow-list.
- Token refresh = **redirect to `/authorize` on 401**; no client/worker refresh code.
- **No production auth bypass** — tests exercise the real verification path via signed tokens + a mocked JWKS.
- Keep the `RATE_LIMITS` KV binding (used by `/ingest`). Remove only `LOGIN_TOKENS` and `VIEWER_SESSIONS`.
- Device-token auth (`worker/src/auth.ts`, `deviceAuth`) is **out of scope** — do not modify.
- Package commands run from `worker/` or `dashboard/` (pnpm workspace). Worker tests: `pnpm test` in `worker/`. Dashboard tests: `pnpm test` in `dashboard/`.
- Assumption: `auth-verify` default-exports nothing relevant and named-exports `requireUser(request: Request, config): Promise<{ sub: string; email: string｜null; name: string｜null; scopes: string[] }>`, throwing a `Response` (401) on verification failure. It does **not** export TS types we rely on — define `VerifiedUser` locally.

## File Structure

**Worker — created:**
- `worker/src/auth_config.ts` — the `AUTH` config constant.
- `worker/test/auth-fixture.ts` — Ed25519 keypair, `installJwks()`, `mintToken()`, `authFetch()`.
- `worker/test/viewer-jwks-error.test.ts` — isolated JWKS-failure → 503 test.

**Worker — modified:**
- `worker/src/viewer.ts` — rewrite: `requireUser` middleware wrapping `auth-verify`.
- `worker/src/api.ts`, `worker/src/read_api.ts` — rename imported `requireViewer` → `requireUser`.
- `worker/src/env.ts` — drop `LOGIN_TOKENS`, `VIEWER_SESSIONS`, `EMAIL`, `EmailMessage`, `EmailSender`.
- `worker/src/index.ts` — drop `authRoutes` import + route.
- `worker/migrations/0001_init.sql` — email nullable, add `name`, drop `allowed_emails`.
- `worker/wrangler.jsonc` — drop the two KV bindings + `send_email`.
- `worker/vitest.config.ts` — drop the two KV namespaces.
- `worker/test/seed.ts` — drop `allowed_emails` inserts.
- `worker/test/migration.test.ts` — update expected tables + assert `name` column.
- `worker/test/viewer.test.ts` — rewrite for gateway auth.
- `worker/test/api.test.ts`, `read-api.test.ts`, `read-api-scope.test.ts` — swap the local `asViewer` helper to token auth.
- `worker/package.json` — add `auth-verify`, `jose`.

**Worker — deleted:**
- `worker/src/auth_routes.ts`, `worker/src/email.ts`, `worker/src/kv.ts`.
- `worker/test/auth_routes.test.ts`, `worker/test/email.test.ts`.

**Dashboard — modified:**
- `dashboard/src/lib/api.ts` — `GATEWAY` const, 401-redirect in `json()`, gateway logout, drop `requestLogin`.
- `dashboard/src/lib/types.ts` — `Me.email: string | null`.
- `dashboard/src/components/LoginGate.tsx` — slim redirector + not-authorized state.
- `dashboard/src/env.d.ts` (or equivalent) — type `PUBLIC_AUTH_GATEWAY`.

**Dashboard — created/replaced:**
- `dashboard/src/lib/__tests__/api-redirect.test.ts` — 401 → redirect.
- `dashboard/src/components/__tests__/logingate.test.tsx` — replace (redirector behavior).
- `dashboard/e2e/login-overview.test.tsx` — rewrite.

---

## Task 1: Worker — gateway verification replaces magic-link session auth

After this task the worker authenticates viewers via auth-gateway JWTs and the full worker suite is green. The now-unused magic-link files (`auth_routes.ts`, `email.ts`, `kv.ts`) and the `allowed_emails` table still exist (removed in Task 2); they compile and their tests still pass.

**Files:**
- Create: `worker/src/auth_config.ts`, `worker/test/auth-fixture.ts`, `worker/test/viewer-jwks-error.test.ts`
- Modify: `worker/package.json`, `worker/migrations/0001_init.sql`, `worker/src/viewer.ts`, `worker/src/api.ts`, `worker/src/read_api.ts`, `worker/test/viewer.test.ts`, `worker/test/api.test.ts`, `worker/test/read-api.test.ts`, `worker/test/read-api-scope.test.ts`

**Interfaces:**
- Produces: `requireUser` (Hono middleware, `export` from `worker/src/viewer.ts`) setting `c.var.viewer.userId = sub`. `AUTH` (from `worker/src/auth_config.ts`). Test helpers `installJwks(): void`, `mintToken(opts: { sub: string; email?: string｜null; name?: string｜null; scopes?: string[] }): Promise<string>`, `authFetch(path: string, sub: string, init?: RequestInit): Promise<Response>` (from `worker/test/auth-fixture.ts`).
- Consumes: `auth-verify`'s `requireUser`; `jose`'s `generateKeyPair`, `exportJWK`, `SignJWT`; `cloudflare:test`'s `SELF`, `fetchMock`, `env`.

- [ ] **Step 1: Add dependencies**

Run in `worker/`:
```bash
pnpm add github:echung32/auth-verify#v1 jose
```
Expected: `worker/package.json` gains `auth-verify` and `jose` under `dependencies`; lockfile updates.

- [ ] **Step 2: Edit the schema — nullable email, add `name`**

In `worker/migrations/0001_init.sql`, replace the `users` table block:
```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT,
  name            TEXT,
  public_to_group INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
```
(Leave `allowed_emails`, `devices`, `sessions` unchanged for now.)

- [ ] **Step 3: Re-apply migrations against a clean local DB**

Run in `worker/`:
```bash
pnpm migrate:local
```
Expected: applies `0001_init.sql` with no error. (If the local DB already has the old schema, delete `.wrangler/state` first, then re-run.)

- [ ] **Step 4: Create the AUTH config**

Create `worker/src/auth_config.ts`:
```ts
// Verification config for the auth-gateway. Values are fixed for the fleet SSO
// deployment; the JWKS is fetched from the gateway and verified offline.
export const AUTH = {
  jwksUrl: 'https://auth.ethanchung.dev/.well-known/jwks.json',
  issuer: 'https://auth.ethanchung.dev',
  audience: 'fleet',
};
```

- [ ] **Step 5: Create the test fixture (keypair, JWKS mock, token minting)**

Create `worker/test/auth-fixture.ts`:
```ts
import { SELF, fetchMock } from 'cloudflare:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const ISSUER = 'https://auth.ethanchung.dev';
const AUDIENCE = 'fleet';
const KID = 'test-key';

// One Ed25519 keypair for the whole test run; its public JWK backs the mocked JWKS.
const keyPair = await generateKeyPair('EdDSA', { extractable: true });
const publicJwk = { ...(await exportJWK(keyPair.publicKey)), kid: KID, alg: 'EdDSA', use: 'sig' };

// Serve the gateway JWKS from fetchMock. Persistent because auth-verify caches the
// remote JWKS and the worker isolate is reused across a file's tests.
export function installJwks(): void {
  fetchMock.activate();
  fetchMock
    .get(ISSUER)
    .intercept({ path: '/.well-known/jwks.json' })
    .reply(200, { keys: [publicJwk] }, { headers: { 'content-type': 'application/json' } })
    .persist();
}

export async function mintToken(opts: {
  sub: string;
  email?: string | null;
  name?: string | null;
  scopes?: string[];
}): Promise<string> {
  return new SignJWT({ email: opts.email ?? null, name: opts.name ?? null, scopes: opts.scopes ?? [] })
    .setProtectedHeader({ alg: 'EdDSA', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(opts.sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keyPair.privateKey);
}

export async function authFetch(path: string, sub: string, init: RequestInit = {}): Promise<Response> {
  const token = await mintToken({ sub });
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
}
```

- [ ] **Step 6: Write the failing viewer tests**

Replace the entire contents of `worker/test/viewer.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, authFetch, mintToken } from './auth-fixture';

describe('requireUser', () => {
  beforeAll(() => installJwks());

  it('401s without a token', async () => {
    const res = await SELF.fetch('https://example.com/api/me');
    expect(res.status).toBe(401);
  });

  it('verifies a token and provisions the user keyed by sub', async () => {
    const res = await authFetch('/api/me', 'gh|alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('gh|alice');
    const row = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind('gh|alice').first();
    expect(row).not.toBeNull();
  });

  it('provisioning is idempotent across requests', async () => {
    await authFetch('/api/me', 'gh|bob');
    await authFetch('/api/me', 'gh|bob');
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind('gh|bob').first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('401s for a malformed token', async () => {
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('401s for a tampered (signature-invalid) token', async () => {
    // Flip the last char of the signature segment → valid shape, bad signature,
    // which jose rejects during verification.
    const good = await mintToken({ sub: 'gh|x' });
    const tampered = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.status).toBe(401);
  });
});

// Note: mintToken always sets issuer/audience to the AUTH values and a 5-minute
// expiry, so wrong-issuer/expired cases would need a parameterized variant; the
// malformed + tampered cases above already exercise the verification-failure path.
```

- [ ] **Step 7: Run viewer tests to verify they fail**

Run in `worker/`:
```bash
pnpm test viewer
```
Expected: FAIL — `viewer.test.ts` cannot resolve the new behavior (old `requireViewer` still uses cookies/KV; `auth-fixture` import of token auth not yet honored by the middleware).

- [ ] **Step 8: Rewrite the middleware**

Replace the entire contents of `worker/src/viewer.ts`:
```ts
import { createMiddleware } from 'hono/factory';
import { requireUser as verifyUser } from 'auth-verify';
import type { AppBindings } from './env';
import { AUTH } from './auth_config';

interface VerifiedUser {
  sub: string;
  email: string | null;
  name: string | null;
  scopes: string[];
}

export const requireUser = createMiddleware<AppBindings>(async (c, next) => {
  let u: VerifiedUser;
  try {
    u = (await verifyUser(c.req.raw, AUTH)) as VerifiedUser;
  } catch (e) {
    if (e instanceof Response) return e; // auth-verify throws a 401 Response
    return c.json({ error: 'auth unavailable' }, 503); // e.g. JWKS fetch failure
  }
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, name, public_to_group, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(u.sub, u.email, u.name, Date.now())
    .run();
  c.set('viewer', { userId: u.sub });
  await next();
});
```

- [ ] **Step 9: Rename the middleware import in the route files**

In `worker/src/api.ts` line 4 and `worker/src/read_api.ts` line 4, change:
```ts
import { requireViewer } from './viewer';
```
to:
```ts
import { requireUser } from './viewer';
```
And update the usage (`apiRoutes.use('/api/*', requireViewer);` → `requireUser`; same in `read_api.ts`).

- [ ] **Step 10: Run viewer tests to verify they pass**

Run in `worker/`:
```bash
pnpm test viewer
```
Expected: PASS (all `requireUser` cases). If the malformed/`.tampered` token returns 503 rather than 401, the package surfaced a JWKS issue — confirm the JWKS interceptor is installed (`installJwks` in `beforeAll`).

- [ ] **Step 11: Add the isolated JWKS-failure test**

Create `worker/test/viewer-jwks-error.test.ts` (separate file → fresh isolate, no JWKS cache bleed):
```ts
import { SELF, fetchMock } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { mintToken } from './auth-fixture';

describe('requireUser when the JWKS endpoint fails', () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock
      .get('https://auth.ethanchung.dev')
      .intercept({ path: '/.well-known/jwks.json' })
      .reply(500, 'boom')
      .persist();
  });

  it('does not authenticate (503 preferred; 401 acceptable)', async () => {
    const token = await mintToken({ sub: 'gh|err' });
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    // 503 = our middleware caught a non-Response error (gateway/JWKS down).
    // 401 = auth-verify wrapped the JWKS failure as a Response. Either keeps the
    // user out; the dashboard's returned=1 guard prevents a redirect loop.
    expect([401, 503]).toContain(res.status);
  });
});
```
Run: `pnpm test viewer-jwks-error` → Expected: PASS.

- [ ] **Step 12: Migrate the API tests to token auth**

In `worker/test/api.test.ts`: remove `import { putViewerSession } from '../src/kv';`, add `import { installJwks, mintToken } from './auth-fixture';` and `import { beforeAll } from 'vitest';` (merge into the existing vitest import). Replace the `asViewer` helper and add a `beforeAll`:
```ts
beforeAll(() => installJwks());

async function asViewer(userId: string, path: string, init: RequestInit = {}) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
}
```
Everything else in the file is unchanged. (The `/api/me` email assertion still holds: `seedUser` pre-creates the row with its email, and `ON CONFLICT DO NOTHING` preserves it.)

Apply the **identical** helper swap (remove the `kv` import, add `installJwks`/`mintToken` + `beforeAll(() => installJwks())`, rewrite `asViewer`) to `worker/test/read-api.test.ts` and `worker/test/read-api-scope.test.ts`.

- [ ] **Step 13: Run the full worker suite**

Run in `worker/`:
```bash
pnpm test
```
Expected: PASS. `auth_routes.test.ts` and `email.test.ts` still pass (their code remains until Task 2). If `viewer.test.ts`'s `gh|alice` row assertion fails because a prior test provisioned a different user, confirm tests use isolated storage (default for this pool).

- [ ] **Step 14: Commit**

```bash
git add worker/
git commit -m "feat(worker): authenticate viewers via auth-gateway JWTs"
```

---

## Task 2: Worker — remove magic-link machinery and the allow-list

Removes the now-dead magic-link code, the `allowed_emails` table, and the unused bindings. Ends with a green worker suite that no longer references KV login/session storage or email.

**Files:**
- Delete: `worker/src/auth_routes.ts`, `worker/src/email.ts`, `worker/src/kv.ts`, `worker/test/auth_routes.test.ts`, `worker/test/email.test.ts`
- Modify: `worker/src/index.ts`, `worker/src/env.ts`, `worker/wrangler.jsonc`, `worker/vitest.config.ts`, `worker/migrations/0001_init.sql`, `worker/test/seed.ts`, `worker/test/migration.test.ts`

**Interfaces:**
- Consumes: `requireUser` from Task 1 (unchanged). No new exports.

- [ ] **Step 1: Delete the magic-link source and tests**

```bash
git rm worker/src/auth_routes.ts worker/src/email.ts worker/src/kv.ts \
       worker/test/auth_routes.test.ts worker/test/email.test.ts
```

- [ ] **Step 2: Unmount the auth routes**

In `worker/src/index.ts`: remove `import { authRoutes } from './auth_routes';` (line 7) and the `app.route('/', authRoutes);` line (line 34). Leave `apiRoutes` and `readApiRoutes` mounts intact.

- [ ] **Step 3: Trim env bindings and email types**

Replace the contents of `worker/src/env.ts` with (drop `EmailMessage`, `EmailSender`, `LOGIN_TOKENS`, `VIEWER_SESSIONS`, `EMAIL`):
```ts
export interface Env {
  DB: D1Database;
  RATE_LIMITS: KVNamespace;
  ASSETS: Fetcher;
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

- [ ] **Step 4: Remove KV bindings and email from wrangler config**

In `worker/wrangler.jsonc`: delete the `LOGIN_TOKENS` and `VIEWER_SESSIONS` entries from `kv_namespaces` (keep `RATE_LIMITS`), and delete the `"send_email": [{ "name": "EMAIL" }]` line.

- [ ] **Step 5: Remove KV namespaces from the test config**

In `worker/vitest.config.ts`, change the `kvNamespaces` line to:
```ts
            kvNamespaces: ['RATE_LIMITS'],
```

- [ ] **Step 6: Drop the allowed_emails table**

In `worker/migrations/0001_init.sql`, delete the `allowed_emails` `CREATE TABLE` block and its preceding comment (the lines describing the M1/M2 allow-list).

- [ ] **Step 7: Remove allowed_emails inserts from the seed helpers**

In `worker/test/seed.ts`:
- In `seedDevice`, remove the `INSERT INTO allowed_emails ...` statement from the `env.DB.batch([...])` array (keep the `users` and `devices` inserts).
- In `seedUser`, remove the `INSERT OR IGNORE INTO allowed_emails ...` statement from the batch (keep the `users` insert).

- [ ] **Step 8: Update the migration test**

In `worker/test/migration.test.ts`:
- Change the expected-tables assertion to drop `'allowed_emails'`:
```ts
    expect.arrayContaining(['devices', 'sessions', 'users']),
```
- Add a check that `users` has a `name` column:
```ts
    const userCols = await env.DB.prepare('PRAGMA table_info(users)').all<{ name: string }>();
    expect(userCols.results.map((c) => c.name)).toEqual(expect.arrayContaining(['name']));
```

- [ ] **Step 9: Re-apply migrations against a clean DB and run the suite**

Run in `worker/`:
```bash
rm -rf .wrangler/state && pnpm migrate:local && pnpm test
```
Expected: PASS, with no references to `allowed_emails`, `LOGIN_TOKENS`, `VIEWER_SESSIONS`, or `EMAIL` remaining. Verify:
```bash
grep -rn "allowed_emails\|LOGIN_TOKENS\|VIEWER_SESSIONS\|sendMagicLink\|requireViewer" worker/src worker/test
```
Expected: no matches.

- [ ] **Step 10: Commit**

```bash
git add worker/
git commit -m "refactor(worker): remove magic-link routes, email, and allow-list"
```

---

## Task 3: Dashboard — 401 redirect and gateway logout in the API client

Centralizes the agreed 401-recovery and switches logout to the gateway.

**Files:**
- Modify: `dashboard/src/lib/api.ts`, `dashboard/src/lib/types.ts`, `dashboard/src/env.d.ts`
- Create: `dashboard/src/lib/__tests__/api-redirect.test.ts`

**Interfaces:**
- Produces: `GATEWAY` (string const), `redirectToLogin()` behavior inside `json()`; `logout()` now POSTs to the gateway. `requestLogin` is removed.
- Consumes: nothing new.

- [ ] **Step 1: Type the gateway env var**

In `dashboard/src/env.d.ts` (create if absent — Astro projects usually have one referencing `astro/client`), add:
```ts
interface ImportMetaEnv {
  readonly PUBLIC_AUTH_GATEWAY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```
(If the file already references `astro/client`, keep that line and add the `PUBLIC_AUTH_GATEWAY` field to the existing `ImportMetaEnv`.)

- [ ] **Step 2: Write the failing redirect test**

Create `dashboard/src/lib/__tests__/api-redirect.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMe } from '@/lib/api';

afterEach(() => vi.restoreAllMocks());

describe('api 401 handling', () => {
  it('redirects to the gateway authorize URL on 401', async () => {
    const loc = { href: 'https://ccusage.ethanchung.dev/overview' };
    vi.stubGlobal('location', loc as unknown as Location);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    // getMe never resolves on 401 (it redirects); race it against a tick.
    await Promise.race([getMe().catch(() => {}), new Promise((r) => setTimeout(r, 10))]);

    expect(loc.href).toContain('https://auth.ethanchung.dev/authorize');
    expect(loc.href).toContain('redirect_uri=');
    expect(loc.href).toContain('returned=1');
  });
});
```
Run in `dashboard/`: `pnpm test api-redirect` → Expected: FAIL (no redirect yet).

- [ ] **Step 3: Implement the redirect + gateway logout**

In `dashboard/src/lib/api.ts`, replace the top of the file (the `json` helper) and the `logout`/`requestLogin` exports:

Add near the top (after the import):
```ts
const GATEWAY = import.meta.env.PUBLIC_AUTH_GATEWAY ?? 'https://auth.ethanchung.dev';

function redirectToLogin(): void {
  const url = new URL(window.location.href);
  // Already bounced back still-unauthenticated → stop, let the UI show the
  // not-authorized state instead of looping.
  if (url.searchParams.get('returned') === '1') return;
  const redirectUri = new URL(window.location.href);
  redirectUri.searchParams.set('returned', '1');
  const authorize = `${GATEWAY}/authorize?redirect_uri=${encodeURIComponent(redirectUri.toString())}`;
  window.location.href = authorize;
}
```
Change `json()` to redirect on 401:
```ts
async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    redirectToLogin();
    // Surface a rejected promise so callers stop; the page is navigating away.
    throw new Error('unauthenticated');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
    throw new Error(`request failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}
```
Remove the `requestLogin` export entirely. Replace `logout`:
```ts
export async function logout(): Promise<void> {
  try {
    await fetch(`${GATEWAY}/logout`, { method: 'POST', credentials: 'include' });
  } catch { /* even if the gateway call fails, fall through to local redirect */ }
}
```

- [ ] **Step 4: Widen the Me.email type**

In `dashboard/src/lib/types.ts`, change `Me.email` to nullable:
```ts
export interface Me { id: string; email: string | null; publicToGroup: boolean; devices: DeviceInfo[] }
```

- [ ] **Step 5: Run the redirect test**

Run in `dashboard/`:
```bash
pnpm test api-redirect
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib
git commit -m "feat(dashboard): redirect to gateway on 401 and log out via gateway"
```

---

## Task 4: Dashboard — slim LoginGate redirector and test cleanup

Replaces the email-form login UI with a redirector + not-authorized state and updates the affected tests.

**Files:**
- Modify: `dashboard/src/components/LoginGate.tsx`, `dashboard/src/components/SettingsDevices.tsx`
- Replace: `dashboard/src/components/__tests__/logingate.test.tsx`, `dashboard/e2e/login-overview.test.tsx`

**Interfaces:**
- Consumes: `getMe`, `logout` from `@/lib/api` (Task 3); `GATEWAY` redirect now lives in `json()`.

- [ ] **Step 1: Write the failing LoginGate tests**

Replace the contents of `dashboard/src/components/__tests__/logingate.test.tsx`:
```ts
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginGate } from '../LoginGate';

afterEach(() => vi.restoreAllMocks());

describe('LoginGate', () => {
  it('sends an authenticated viewer to /overview', async () => {
    const loc = { href: 'https://ccusage.ethanchung.dev/' } as unknown as Location;
    vi.stubGlobal('location', loc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'gh|a', email: null, publicToGroup: false, devices: [] }), { status: 200 })));
    render(<LoginGate />);
    await waitFor(() => expect(loc.href).toContain('/overview'));
  });

  it('shows the not-authorized state when returned=1 and still unauthenticated', async () => {
    const loc = { href: 'https://ccusage.ethanchung.dev/?returned=1' } as unknown as Location;
    vi.stubGlobal('location', loc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<LoginGate />);
    await waitFor(() => expect(screen.getByText(/not authorized/i)).toBeInTheDocument());
  });

  it('renders no email form', async () => {
    vi.stubGlobal('location', { href: 'https://ccusage.ethanchung.dev/' } as unknown as Location);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<LoginGate />);
    await waitFor(() => expect(screen.queryByLabelText('email')).not.toBeInTheDocument());
  });
});
```
Run in `dashboard/`: `pnpm test logingate` → Expected: FAIL (old email-form component still rendered).

- [ ] **Step 2: Rewrite LoginGate as a redirector**

Replace the contents of `dashboard/src/components/LoginGate.tsx`:
```tsx
import { useEffect, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import { getMe } from '@/lib/api';

type State = 'checking' | 'denied';

export function LoginGate() {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    getMe()
      .then(() => { window.location.href = '/overview'; })
      // On 401 the api client has already redirected to the gateway. If we got
      // here it's a non-redirecting failure or the returned=1 guard fired →
      // show the terminal not-authorized state.
      .catch(() => {
        const returned = new URL(window.location.href).searchParams.get('returned') === '1';
        if (returned) setState('denied');
      });
  }, []);

  const Centered = ({ children }: { children: React.ReactNode }) => (
    <Box margin={{ top: 'xxxl' }}><div style={{ maxWidth: 420, margin: '0 auto' }}>{children}</div></Box>
  );

  if (state === 'denied') {
    return (
      <Centered>
        <Container header={<Header variant="h2">Not authorized</Header>}>
          <Box>Your account isn’t permitted to access this app. Contact the owner if you think this is a mistake.</Box>
        </Container>
      </Centered>
    );
  }
  return <Centered><Box color="text-status-inactive">Redirecting to sign in…</Box></Centered>;
}
```

- [ ] **Step 3: Run the LoginGate tests**

Run in `dashboard/`:
```bash
pnpm test logingate
```
Expected: PASS.

- [ ] **Step 4: Fix the logout caller (logout now returns void)**

In `dashboard/src/components/SettingsDevices.tsx` line ~64, the logout button currently does `logout().then(() => { window.location.href = '/'; })`. Keep it — `logout()` still returns a promise. Confirm it compiles (the `.then` callback no longer receives `{ ok: true }`, which is fine since it's unused). No code change needed unless TS complains; if it does, change to:
```tsx
onClick={() => { logout().finally(() => { window.location.href = '/'; }); }}
```

- [ ] **Step 5: Rewrite the e2e test**

Replace `dashboard/e2e/login-overview.test.tsx` so the gate's authenticated path redirects and the unauthenticated path does not render a form. Replace the `LoginGate` assertions block:
```ts
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../src/components/Overview';
import { LoginGate } from '../src/components/LoginGate';

const canRun = typeof document !== 'undefined' && process.env.CI_SKIP_E2E !== '1';

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!canRun)('e2e: login -> overview', () => {
  it('an authenticated viewer is redirected and overview shows totals', async () => {
    const okMe = { id: 'gh|u1', email: null, publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] };
    const loc = { href: 'https://ccusage.ethanchung.dev/' } as unknown as Location;
    vi.stubGlobal('location', loc);
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

    const gate = render(<LoginGate />);
    await waitFor(() => expect(loc.href).toContain('/overview'));
    gate.unmount();

    render(<Overview />);
    await waitFor(() => expect(screen.getByText('1,000')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/\$9\.99/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the full dashboard suite**

Run in `dashboard/`:
```bash
pnpm test
```
Expected: PASS. Verify no stale references:
```bash
grep -rn "requestLogin\|magic link\|/auth/request\|/auth/callback" dashboard/src
```
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add dashboard/
git commit -m "feat(dashboard): replace magic-link login UI with gateway redirect"
```

---

## Deployment notes (post-merge, manual)

- Reset the remote D1 (no data worth keeping): drop/recreate the database or clear its migration state, then `wrangler d1 migrations apply ccusage-cloud` with the edited `0001_init.sql`.
- Delete the now-unused `LOGIN_TOKENS` and `VIEWER_SESSIONS` KV namespaces in the Cloudflare dashboard after deploy.
- Confirm the Worker's origin is whitelisted in auth-gateway (required for both the JWKS audience and the credentialed `/logout` CORS POST).
- Set `PUBLIC_AUTH_GATEWAY` in the dashboard build env if it should differ from the `https://auth.ethanchung.dev` default.

## Self-Review notes

- **Spec coverage:** middleware (§1 → T1), schema (§2 → T1/T2), removals (§3 → T2), dashboard 401 + logout (§4 → T3), redirect-loop guard (§4 → T3/T4), config (§5 → T3), edge cases incl. 503 + null email (§6 → T1 + T3), testing incl. real-JWKS fixture and harness changes (§Testing → T1/T2/T4). All covered.
- **503 caveat:** exact 503-vs-401 on JWKS failure depends on `auth-verify` internals; the test tolerates both and the `returned=1` guard is the real loop-safety net. Flagged for verification during execution.
- **Type consistency:** `requireUser` (middleware) vs `verifyUser` (aliased package import) used consistently; `mintToken`/`installJwks`/`authFetch` signatures match across fixture and consumers; `Me.email` widened to `string | null` where provisioned email may be null.

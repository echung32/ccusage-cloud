# Replace Magic Links with auth-gateway

**Date:** 2026-06-25
**Status:** Approved (design)
**Branch context:** ccusage-cloud worker + dashboard

## Goal

Replace the email Magic Link sign-in for the **viewer/browser** session with
[`auth-gateway`](https://github.com/echung32/auth-gateway) SSO. The gateway issues
EdDSA JWTs in a `__Secure-fleet_at` cookie shared across `*.ethanchung.dev`; the
Worker verifies them offline against the gateway's JWKS using the managed
`auth-verify` package.

The **device-token auth** for the CLI (`deviceAuth`, Bearer vs `devices` table) is
unrelated and stays untouched.

## Decisions

| Topic | Decision |
|---|---|
| Deploy domain | Worker is served from a subdomain of `ethanchung.dev`, so the shared `__Secure-fleet_at` cookie reaches it directly. |
| Authorization | **Trust the gateway.** Any user with a valid `fleet`-audience token is allowed in and auto-provisioned. No local allow-list. |
| Token refresh | **Redirect to `/authorize` on 401.** No client/worker token-refresh code; the gateway re-issues silently if the refresh cookie is valid. |
| Identity key | **Fresh start, no migration.** `users.id` = gateway `sub` (e.g. `gh|123`). |
| Removal scope | Remove **all** magic-link machinery (routes, email, login-token KV, viewer-session KV, interstitial, auth rate-limit). |
| Logout | **Gateway `/logout`** (credentialed POST) — true SSO logout across `*.ethanchung.dev`. |
| Verification | Use the managed `auth-verify` package (`requireUser(request, config)`), not a hand-rolled `jose` middleware. |
| Naming | Rename our middleware export `requireViewer` → `requireUser` everywhere. |

## Package interface (auth-verify)

Installed via `pnpm add github:echung32/auth-verify#v1` (peer dependency `jose`).

```ts
requireUser(request: Request, config: AuthConfig): Promise<VerifiedUser>
// Reads Bearer header OR __Secure-fleet_at cookie.
// THROWS a `Response` (status 401) on verification failure.

interface VerifiedUser {
  sub: string;          // "gh|<github-id>"
  email: string | null;
  name: string | null;
  scopes: string[];
}
```

Config:

```ts
const AUTH = {
  jwksUrl: 'https://auth.ethanchung.dev/.well-known/jwks.json',
  issuer: 'https://auth.ethanchung.dev',
  audience: 'fleet',
};
```

## Architecture

### 1. Worker — `requireUser` middleware (replaces `requireViewer`)

`worker/src/viewer.ts` is rewritten. The package's export and our middleware share
the name `requireUser`, so the import is aliased.

```ts
import { createMiddleware } from 'hono/factory';
import { requireUser as verifyUser, type VerifiedUser } from 'auth-verify';
import type { AppBindings } from './env';
import { AUTH } from './auth_config';

export const requireUser = createMiddleware<AppBindings>(async (c, next) => {
  let u: VerifiedUser;
  try {
    u = await verifyUser(c.req.raw, AUTH);
  } catch (e) {
    if (e instanceof Response) return e;                 // 401 from the package
    return c.json({ error: 'auth unavailable' }, 503);   // JWKS/network failure
  }
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, name, public_to_group, created_at) ' +
    'VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING',
  ).bind(u.sub, u.email, u.name, Date.now()).run();
  c.set('viewer', { userId: u.sub });
  await next();
});
```

- `c.var.viewer.userId` contract is preserved → `api.ts`, `read_api.ts` need only
  swap the import name `requireViewer` → `requireUser`.
- `users.id` is the gateway `sub`. `devices.user_id` / `sessions.user_id` reference
  it unchanged.
- Provision-once: `ON CONFLICT DO NOTHING` keeps email/name as captured at first
  sign-in (refreshing them is YAGNI).

Files touched for the rename: `worker/src/viewer.ts`, `worker/src/api.ts`,
`worker/src/read_api.ts`, `worker/test/viewer.test.ts`.

### 2. Schema (edit `worker/migrations/0001_init.sql` — DB is fresh)

- `users.email` → **nullable** (gateway email may be null).
- Add `users.name TEXT`.
- **Drop** the `allowed_emails` table (and its comment block).
- `devices` / `sessions` unchanged.

The remote D1 currently has the magic-link schema applied, but it holds no data
worth preserving (everything is re-fetchable via `ccusage-cloud sync`). So we
**reset the database** rather than write a forward migration: drop/recreate the
remote D1 (or clear its migration state) and apply the edited `0001_init.sql`
fresh. Locally, re-apply with `pnpm --filter @ccusage-cloud/worker migrate:local`
against a clean DB.

### 3. Removals (Worker)

- Delete `worker/src/auth_routes.ts` (magic-link routes, interstitial page,
  `SESSION_COOKIE`), `worker/src/email.ts`, `worker/src/kv.ts` (all helpers now
  unused).
- Keep `worker/src/ratelimit.ts` — `/ingest` still uses it (`index.ts:18`). Remove
  only the `auth:<ip>` rate-limit call (which lived in `auth_routes.ts`).
- `worker/src/env.ts`: remove `LOGIN_TOKENS`, `VIEWER_SESSIONS`, `EMAIL`; **keep**
  `RATE_LIMITS`.
- `worker/wrangler.jsonc`: remove the `LOGIN_TOKENS` and `VIEWER_SESSIONS` KV
  bindings and the `send_email` block; keep `RATE_LIMITS`.
- Remove the `/auth/*` route registration from `worker/src/index.ts` (the dashboard
  now talks to the gateway directly for login/logout).

### 4. Dashboard

- New shared constant `GATEWAY` = `import.meta.env.PUBLIC_AUTH_GATEWAY` falling back
  to `'https://auth.ethanchung.dev'`.
- `dashboard/src/lib/api.ts`:
  - In the shared `json()` helper, **on `res.status === 401`**, redirect:
    `window.location.href = ${GATEWAY}/authorize?redirect_uri=<encoded current URL>`.
    This centralizes the agreed 401-recovery for every API call.
  - Remove `requestLogin`.
  - `logout()` → `fetch(${GATEWAY}/logout, { method: 'POST', credentials: 'include' })`
    then redirect to the signed-out landing (`/`).
- `dashboard/src/components/LoginGate.tsx` shrinks to a redirector. The **global
  `json()` 401 handler owns the redirect** (see below), so `LoginGate` does not
  duplicate it: on mount it calls `getMe()`; on success → `/overview`; otherwise the
  401 path inside `json()` has already navigated to `/authorize`, so `LoginGate`
  only needs to render the "Redirecting to sign in…" splash and the terminal
  not-authorized state (when `returned=1` is present). The email form /
  "Check your inbox" states are removed.
- `dashboard/src/pages/login.astro` hosts the slim redirector (unchanged role as the
  landing for unauthenticated users).

#### Redirect-loop guard

When redirecting to `/authorize`, append a `returned=1` sentinel to `redirect_uri`.
On bounce-back, if an API call still returns 401 **and** `returned=1` is present,
show a terminal "Not authorized for this app" message instead of redirecting again.
This covers a gateway-authenticated user the app cannot serve (and any gateway
misconfiguration), preventing an infinite redirect loop.

### 5. Config

`worker/src/auth_config.ts` exports the `AUTH` constant (used by the middleware).
The dashboard reads `GATEWAY` from `PUBLIC_AUTH_GATEWAY` so the base URL is not
hardcoded in two places.

## Error handling & edge cases

- Package throws a `Response` on verification failure → returned as-is (401) →
  dashboard redirects to `/authorize`.
- Non-`Response` error (JWKS fetch / network) → **503** (distinct from 401) so the
  dashboard does **not** redirect-loop during a gateway outage; surface a transient
  error instead.
- `email` / `name` null → stored null; `/api/me` and the Settings UI render a
  fallback (`—`) rather than assuming an email is present.
- Logout requires the gateway to allow a credentialed CORS POST from our origin —
  already implied by our origin being whitelisted.

## Testing

The worker tests are **integration tests** (`SELF.fetch` runs the real worker in
workerd), where module-mocking `auth-verify` is unreliable. So viewer
authentication in tests exercises the **real verification path**: a test helper
mints Ed25519-signed JWTs with `jose` (a direct dep via `auth-verify`'s peer dep),
and `fetchMock` (from `cloudflare:test`) serves a matching JWKS. **No production
auth bypass is added.**

### Test helper (`worker/test/auth-fixture.ts`)

- Generates one Ed25519 keypair (module scope), exports its public JWK with
  `kid: 'test-key'`, `alg: 'EdDSA'`, `use: 'sig'`.
- `installJwks()` — registers a **persistent** `fetchMock` interceptor for
  `GET https://auth.ethanchung.dev/.well-known/jwks.json` returning `{ keys: [jwk] }`
  (persistent because `auth-verify`'s `createRemoteJWKSet` caches and the worker
  isolate is reused across a file's tests).
- `mintToken({ sub, email?, name?, scopes? })` — signs a JWT with issuer
  `https://auth.ethanchung.dev`, audience `fleet`, the given `sub`, 5-minute expiry.
- `authFetch(path, sub, init?)` — `SELF.fetch` with `Authorization: Bearer <token>`.

### Worker tests

- **`worker/test/viewer.test.ts`** (rewritten — the core auth tests):
  - no token → 401.
  - valid token → provisions a `users` row keyed by `sub` + sets
    `c.var.viewer.userId = sub` (assert via `/api/me`).
  - malformed/expired token (real `jose` verification) → 401.
  - JWKS endpoint unreachable (interceptor returns 500) → middleware returns **503**,
    not 401.
  - provisioning idempotent: two `authFetch` calls for the same `sub` → one row.
- **`api.test.ts`, `read-api.test.ts`, `read-api-scope.test.ts`**: replace
  `putViewerSession` + `cookie` with `authFetch(path, sub)` (and seed sessions/devices
  with `user_id = sub`).
- **`migration.test.ts`**: drop `allowed_emails` from the expected-tables assertion;
  assert `users` has a nullable `name` column.
- **Delete**: `worker/test/auth_routes.test.ts` (magic-link routes),
  `worker/test/email.test.ts` (email removed).

### Test harness changes

- **`worker/test/seed.ts`**: remove the `allowed_emails` inserts from `seedDevice`
  and `seedUser` (table is gone). Other fields unchanged; existing
  query/ingest/group-summary tests that only seed DB rows keep working.
- **`worker/vitest.config.ts`**: drop `LOGIN_TOKENS` and `VIEWER_SESSIONS` from
  `kvNamespaces` (keep `RATE_LIMITS`).

### Dashboard tests

- **Delete** `dashboard/src/components/__tests__/logingate.test.tsx` (email-form
  test); replace with a test that the slim `LoginGate` redirects on no-session and
  renders the not-authorized state when `returned=1` is present (mock `@/lib/api`
  and `window.location`).
- **`json()` 401 redirect**: unit-test that a 401 response triggers
  `window.location.href` to the gateway `/authorize` URL with an encoded
  `redirect_uri` (mock `window.location`).
- **Rewrite** `dashboard/e2e/login-overview.test.tsx`: with `getMe` resolving, the
  overview loads; with `getMe` 401-ing, the gate redirects to the gateway.
- Component tests that mock `@/lib/api` (charts/tables) are unaffected.

## Out of scope

- Device-token (CLI) auth — unchanged.
- Silent/worker-side token refresh — explicitly rejected in favor of redirect-on-401.
- Local authorization / allow-list — removed; the gateway owns access control.
- Data migration — none; fresh DB.

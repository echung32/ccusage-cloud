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

Re-apply with `pnpm --filter @ccusage-cloud/worker migrate:local` (and the remote
equivalent) against the empty DB.

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

- **Unit (`worker/test/viewer.test.ts`)** with `vi.mock('auth-verify')`:
  - valid `VerifiedUser` → provisions a `users` row + sets `c.var.viewer.userId = sub`.
  - package throws a `Response` → propagated as 401.
  - package throws a non-`Response` error → middleware returns 503.
  - provisioning is idempotent: two requests for the same `sub` create one row.
- **Dashboard:** `json()` on 401 → triggers redirect (mock `window.location`); the
  `returned=1` guard renders the not-authorized terminal state.
- **Remove** obsolete magic-link tests: `worker/test/auth_routes.test.ts`,
  `dashboard/src/components/__tests__/logingate.test.tsx`.
- **Rewrite** `dashboard/e2e/login-overview.test.tsx`: with a valid cookie/Bearer the
  overview loads; without one, the gate redirects to the gateway.

## Out of scope

- Device-token (CLI) auth — unchanged.
- Silent/worker-side token refresh — explicitly rejected in favor of redirect-on-401.
- Local authorization / allow-list — removed; the gateway owns access control.
- Data migration — none; fresh DB.

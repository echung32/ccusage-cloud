# Design: Security headers, read-API rate limits, device rename

**Date:** 2026-06-28
**Status:** Approved (pending spec review)
**Branch:** `feat/security-ratelimit-rename`

## Summary

Three independent, small hardening/UX improvements to the Worker and dashboard:

1. **Security headers** on all Worker responses.
2. **Rate limiting** on the authenticated read APIs (currently unprotected).
3. **Device rename** — let a user change a device's label after creation.

No D1 schema migration is required.

## Motivation

- The read APIs (`/api/summary`, `/api/sessions`, `/api/me`, etc.) have no rate
  limiting, unlike `/ingest` and `/api/enroll`. An authenticated user could hammer
  D1 with large unbounded queries.
- Responses ship no security headers (HSTS, nosniff, frame protection).
- Device labels are fixed at creation; the only way to fix a typo is to revoke and
  re-enroll. A rename is a small, obvious quality-of-life gap.

---

## 1. Security headers (Worker)

Add Hono's `secureHeaders` middleware (`hono/secure-headers`) as the first
`app.use('*', ...)` in `worker/src/index.ts`, so it applies to both API responses
and dashboard assets served via the `ASSETS` binding.

Headers set:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

**CSP is intentionally omitted.** Cloudscape Design System + Astro/React islands
require a carefully tuned `Content-Security-Policy` (inline styles, nonce/hashes);
shipping a strict one blind would break the dashboard. A code comment will note the
deferral. CSP is tracked as out-of-scope future work.

The middleware must register before route handlers so the headers are applied to
every response, including the `app.all('*')` asset fallback.

---

## 2. Read-API rate limits (Worker)

Reuse the existing KV token-bucket `rateLimit()` (`worker/src/ratelimit.ts`,
unchanged).

Add a `viewerRateLimit` middleware that:

- runs **after** `requireUser` (so it keys on the authenticated user, not IP),
- keys on `viewer:${userId}`,
- limit **300 requests / 60s** per user,
- returns `429 { error: 'rate limited' }` when exceeded.

A normal dashboard page load fans out to several endpoints, so the ceiling is
deliberately generous; 300/60s is invisible in normal use but caps abuse.

### Double-count avoidance

Both `apiRoutes` and `readApiRoutes` register `requireUser` on `/api/*`, and both
sub-routers match a request to e.g. `/api/summary`. To ensure a single request is
counted once, `viewerRateLimit` sets a request-scoped flag (`c.set('rlChecked', true)`)
and no-ops if the flag is already set. The flag is added to the Hono `Variables`
type in `worker/src/env.ts`.

`viewerRateLimit` is registered on `/api/*` immediately after `requireUser` in both
`api.ts` and `read_api.ts`. It therefore covers `/api/me`, `/api/devices`,
`/api/enroll-codes`, `/api/summary`, and `/api/sessions`.

> Note: `/api/enroll` is mounted directly in `index.ts` (not under the `/api/*`
> middleware) and keeps its own existing IP-based rate limit.

---

## 3. Device rename (Worker + dashboard)

### Worker

New route `PATCH /api/devices/:id` in `worker/src/api.ts`:

- body `{ label }`, validated by the existing label schema
  (`v.string()`, `minLength(1)`, `maxLength(100)` — extracted/shared with the
  `POST /api/devices` schema),
- `UPDATE devices SET label = ? WHERE id = ? AND user_id = ?`,
- `404 { error: 'not found' }` if no row changed (unknown id or not owned),
- `400 { error: 'invalid label' }` on validation failure,
- `200 { ok: true }` on success.

Renaming a revoked device is permitted (harmless; no `revoked_at` condition).

### Dashboard

- `renameDevice(id, label)` added to `dashboard/src/lib/api.ts`
  (`PATCH /api/devices/${id}` with JSON body, `credentials: 'include'`).
- In `SettingsDevices.tsx`, make the **Device** column inline-editable using
  Cloudscape `Table`'s `editConfig` + the table's `submitEdit` handler. On submit,
  call `renameDevice(id, newLabel)` then `refresh()`.
- The revoked-state suffix (`"(revoked)"`) display logic is preserved; editing still
  edits the underlying label.

---

## Testing

Matches the repo's existing coverage conventions.

**Worker (`worker/test/`):**
- rename: success; 404 for unknown id; 404 when device belongs to another user;
  400 for empty/too-long label.
- read rate limit: returns 200 under the limit, `429` once the per-user threshold
  is exceeded within the window.
- security headers: a representative response carries the four headers.

**Dashboard (`dashboard/src/components/__tests__/settingsdevices.test.tsx`):**
- inline-editing a device label calls `renameDevice` with the new value and
  refreshes the list.

---

## Out of scope

Deferred, noted but not built here:

- Content-Security-Policy.
- IP-based rate limiting for read APIs.
- Audit logging of device changes.
- Data retention / purge.
- Time-range clamping on read queries (separate hardening task).

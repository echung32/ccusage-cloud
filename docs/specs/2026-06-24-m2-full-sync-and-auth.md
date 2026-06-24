# ccusage-cloud M2 — Full Sync + Viewer Auth (Milestone Spec)

**Date:** 2026-06-24
**Status:** Planned (forward note; full TDD plan to be written via writing-plans before implementation)
**Builds on:** M1 (end-to-end push). Parent design: `2026-06-24-ccusage-cloud-design.md`.

> **⚠ Spec drift check — run BEFORE implementing this milestone.**
> Re-read the parent design spec and the M1 plan, then verify:
> 1. **ccusage JSON shape** — run `ccusage claude session --json` (and one other
>    source) and confirm fields still match `SessionSchema` / `SessionRowSchema`.
>    ccusage is an unmodified upstream dependency; fields can change between
>    releases. If they have, update the schemas + this spec first.
> 2. **M1 interfaces** — confirm `syncOnce`, `loadSessions`, `Config`,
>    `upsertSessions`, `deviceAuth` exist with the names/signatures M2 extends.
> 3. **Decisions** — confirm nothing decided in conversation since 2026-06-24
>    contradicts this spec (sources list, token format, email sender, KV TTLs).
> If anything deviates, amend the spec and note the change before writing code.

## Goal

Make sync production-usable (all sources, incremental, resilient) and let
invited humans log in to the dashboard (magic links), with the minimal
device-management + settings API the M3 dashboard will consume.

## Scope

### A. Sync hardening (CLI)
1. **All sources.** Iterate the full source list; skip any that error or return
   empty (already the per-source behavior from M1's `loadSessions`).
   `--source <s>` limits to one source.
2. **Incremental state.** `~/.config/ccusage-cloud/state.json` stores a content
   hash per `(source, sessionId)`. Only new/changed sessions are pushed.
   `--full` ignores state and re-sends everything (drift repair).
3. **Chunking + retry.** Split the push into batches of 500 sessions. Retry each
   batch with exponential backoff on network/5xx. Persist hashes for
   successfully-delivered batches only, so an interrupted run resumes cleanly.
4. **`status` command.** Print server URL, device label, last sync time, and
   pending (unsynced) session count.

### B. Viewer auth (Worker)
5. **Magic-link login.** `POST /auth/request { email }` → if email ∈
   `allowed_emails`, mint a single-use token in KV `LOGIN_TOKENS` (TTL 15 min),
   email a link via Cloudflare Email Sending from `no-reply@ethanchung.dev`.
   Always returns 200 (no enumeration).
6. **Callback + session.** `GET /auth/callback?token=…` consumes the token,
   creates a `VIEWER_SESSIONS` entry (TTL 30 days, sliding), sets an
   `HttpOnly; Secure; SameSite=Lax` cookie, redirects to `/`.
7. **Logout.** `POST /auth/logout` deletes the session + clears the cookie.
8. **Viewer-session middleware** (`requireViewer`) resolving the cookie → user.

### C. Account/device API (Worker) — consumed by M3
9. `GET /api/me` → `{ id, email, publicToGroup, devices: [...] }`.
10. `POST /api/devices { label }` → mint a device token (returns plaintext
    **once**); replaces the M1 seed script for real enrollment.
11. `DELETE /api/devices/:id` → set `revoked_at`.
12. `PATCH /api/me { publicToGroup }` → toggle group sharing.

### D. Testing
13. **Automated cross-process e2e** via `wrangler unstable_dev`: start the Worker
    with a local D1, seed a device, run the CLI `syncOnce` against it with a
    fixture runner, assert rows in D1 — the e2e deferred from M1 Task 9.

## New / changed files (anticipated)

- CLI: `src/state.ts` (load/save/diff hashes), `src/sources.ts` (source list),
  changes to `src/sync.ts` (state-aware diff, chunking, retry) and `src/index.ts`
  (`--full`, `--source`, `status`).
- Worker: `src/kv.ts` (typed KV wrappers), `src/email.ts` (`sendMagicLink`),
  `src/auth_routes.ts` (`/auth/*`), `src/viewer.ts` (`requireViewer` middleware),
  `src/api.ts` (`/api/me`, `/api/devices`), `wrangler.jsonc` (KV namespaces +
  email binding), `env.ts` (add `LOGIN_TOKENS`, `VIEWER_SESSIONS`, email binding).

## Data

- KV `LOGIN_TOKENS`: `token → { email }`, TTL 900s, deleted on consume.
- KV `VIEWER_SESSIONS`: `sessionId → { userId }`, TTL 2,592,000s (30d), sliding.
- Device token: minted server-side (`cccloud_` + base64url(32)), only
  `token_sha256` stored, plaintext returned once.

## Edge cases / security

- Email not in allowlist → 200 with no email sent.
- Login token single-use; reuse or expiry → 401 at callback.
- Cookie `HttpOnly; Secure; SameSite=Lax`; callback uses a `state`/PKCE-style
  nonce or relies on SameSite to mitigate CSRF on the GET callback.
- Device-mint endpoint requires a valid viewer session.
- Email send failure must not 500 the request after the token is minted — log
  and still return 200 (user can re-request).

## Out of scope (later milestones)

- Dashboard UI (M3). Aggregation read endpoints `/api/summary`, `/api/sessions`
  (M3). Group scope, redaction, rate limiting, charts (M4).

# ccusage-cloud — Design Spec

**Date:** 2026-06-24
**Status:** Approved design, pending implementation plan

## Purpose

`ccusage` reports coding-agent token usage and cost, but only **per-device** —
it reads local log files. This project aggregates usage across **multiple
devices** and a **small group of people** into a single Cloudflare-hosted
dashboard, without modifying ccusage itself.

## Goals

- Aggregate full session-level usage from many devices into one place.
- Let a small invited group push their devices' data and view a dashboard.
- Stay **conflict-free with upstream ccusage**: ccusage is consumed as an
  unmodified installed CLI; all new code lives in this separate repo.
- Keep operational cost and maintenance low.

## Non-Goals (YAGNI)

- **No real-time/live streaming.** Sync is on-demand (manual or cron). No
  daemon, no Durable Objects, no WebSockets.
- **No public multi-tenant signup.** Access is an email allowlist.
- **No modification of the ccusage source tree.**
- **No mobile app / native clients.** Web dashboard only.

## Key Decisions (resolved during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| External tool vs. integrated | **External tool** | ccusage already emits complete `session --json`; keeps the fork upstream-mergeable. |
| Liveness | **On-demand only** | No daemon/DO. Pure D1. Cheapest, most robust. |
| Tenancy | **Me + a few invited people** | Per-user tokens + users table, email allowlist, no public signup. |
| Data granularity | **Full session detail** | Drill-down to individual sessions. Idempotent upserts. |
| Code location | **Separate repo** (`ccusage-cloud`) | Zero upstream merge risk. |
| Viewer auth | **App-level magic links** via Cloudflare Email Sending (from `no-reply@ethanchung.dev`) | Full control; small known allowlist. |
| Device push auth | **Per-device bearer tokens** | Decoupled from viewer auth. |
| Group sharing | **Opt-in**, default private | Each user explicitly chooses to expose stats to the group. |
| Public/group detail | **Overall only** (no per-project) | Group view shows totals/trends; project names never appear in others' views. |
| Project paths | **Stored plaintext** (`--redact-projects` optional, default off) | Acceptable per owner; redaction available if wanted. |
| Deployment topology | **Single Worker** (Hono entry + Astro static assets) | One deploy, one origin, no CORS/service binding. Dashboard needs no SSR. |

## Architecture

Three independent, separately-testable components. Components 2 and 3 deploy as
a **single Cloudflare Worker**: Hono is the Worker entry and serves the API
(`/ingest`, `/auth/*`, `/api/*`); all other paths fall through to the Astro
**static build** via the Worker Assets binding (`env.ASSETS.fetch`). The
dashboard is client-rendered (hydrated islands hitting the JSON API), so no SSR
Worker is needed. The Worker is bound to a **custom domain** on the
`ethanchung.dev` zone (the `workers.dev` route is disabled); the dashboard and
the `no-reply@ethanchung.dev` sender share that zone.

```
Device(s)                         Cloudflare
┌───────────────────┐
│ ccusage (vanilla) │
│   session --json  │
└─────────┬─────────┘
          │ shell out
┌─────────▼─────────┐  HTTPS + Bearer (device token)   ┌──────────────────────┐
│ 1. sync CLI       │ ───────────────────────────────▶ │ 2. Worker API (Hono) │
│ (ccusage-cloud)   │                                  │  POST /ingest        │
│  - iterate sources│                                  │  /auth/* (magic link)│
│  - diff vs state  │                                  │  GET /api/* (viewer) │
│  - POST changes   │                                  ├──────────────────────┤
└───────────────────┘                                  │ D1: users, devices,  │
                                                        │     sessions         │
                          serves static assets          │ KV: login tokens,    │
          ┌──────────────────────────────────────────  │     viewer sessions  │
          ▼                                             └──────────────────────┘
┌───────────────────┐
│ 3. Dashboard      │  (Astro + Vite, static build served by the SAME Worker
└───────────────────┘   via env.ASSETS — not a separate Worker)
```

**Two decoupled auth paths:**
- Devices → server: per-device bearer token (push only; cannot read).
- Humans → dashboard: magic-link session cookie (read only; cannot ingest).

A leaked device token can only push as that device; a viewer session cannot
forge ingest. Revoking either is independent.

---

## Component 1: Sync CLI (`ccusage-cloud`)

A small TypeScript/Node CLI published to npm (or run via `npx`). Language chosen
to match the Worker and dashboard (one toolchain) and because it only shells out
and posts JSON.

### Identity & enrollment

The account is **baked into a per-device token, resolved server-side**. The CLI
never knows or trusts a user id.

1. User logs into the dashboard (magic link) → authenticated user.
2. Dashboard → **Add device** → Worker mints `cccloud_<32 random bytes,
   base64url>`, stores a `devices` row `(id, user_id, token_sha256, label,
   created_at)`, and shows the token **once**.
3. On the machine: `ccusage-cloud login --token cccloud_…` → written to
   `~/.config/ccusage-cloud/config.json` (chmod 600).
4. Every push sends `Authorization: Bearer cccloud_…`. The Worker SHA-256s it,
   looks up the `devices` row → resolves `user_id` + `device_id`.

Revoke a device = delete its row. Rotate = mint a new token, delete the old.

### Commands

- `ccusage-cloud login --token <token>` — store credentials + server URL.
- `ccusage-cloud sync [--full] [--source <s>] [--redact-projects] [--ccusage-bin <path>] [--dry-run]`
- `ccusage-cloud status` — show server URL, device label, last sync, pending count.
- `ccusage-cloud logout` — remove local credentials.

### `sync` behavior

```
sources = [claude, codex, opencode, amp, droid, codebuff, hermes,
           pi, goose, openclaw, kilo, kimi, qwen, copilot, gemini]
for source in sources:
    rows = run(`<ccusage-bin> <source> session --json`)   # skip on error/empty
    tag each row with `source`
all = collect(rows)
if --redact-projects: hash/strip projectPath
changed = diff(all, ~/.config/ccusage-cloud/state.json)   # sha256 per sessionId
for batch in chunk(changed, 500):
    POST /ingest { sessions: batch }   # Bearer device token
    on 200: persist delivered batch hashes to state.json
```

- **Idempotent**: server upserts on `(user_id, device_id, source, session_id)`.
  Re-running is always safe.
- **Incremental**: `state.json` holds a content hash per session; only
  new/changed sessions are sent. `--full` re-sends everything to repair drift.
- **Active sessions** grow between syncs → hash changes → re-upsert overwrites.
  Correct by construction.
- **Trigger**: manual, or user-wired cron/launchd. The tool ships example
  schedules; it does **not** install a daemon.
- **ccusage discovery**: `npx ccusage` / `$PATH`, overridable via `--ccusage-bin`
  or config — pins the dependency outside the fork.

### Per-session fields consumed (from `ccusage <source> session --json`)

`sessionId`, `inputTokens`, `outputTokens`, `cacheCreationTokens`,
`cacheReadTokens`, `totalTokens`, `totalCost`, `credits?`, `firstActivity`,
`lastActivity`, `modelsUsed`, `modelBreakdowns`, `projectPath`. (Verified
present in ccusage `output.rs::session_summary_json`.)

### Privacy

`projectPath` can reveal client/work names. `--redact-projects` SHA-256s the
path (stable id, no plaintext leaves the device). Off by default; documented
prominently.

---

## Component 2: Worker API (Hono on Cloudflare Workers)

### Storage

**D1 (SQLite)** for durable relational data:

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,    -- ulid
  email           TEXT NOT NULL UNIQUE,
  public_to_group INTEGER NOT NULL DEFAULT 0,  -- opt-in: 1 = stats visible to group
  created_at      INTEGER NOT NULL
);

CREATE TABLE allowed_emails (         -- the invite allowlist
  email    TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,      -- ulid
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
  models_used           TEXT,         -- JSON array
  model_breakdowns      TEXT,         -- JSON
  project_path          TEXT,         -- redacted hash if --redact-projects
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, source, session_id)
);
CREATE INDEX idx_sessions_user_activity ON sessions(user_id, last_activity);
```

**KV** for ephemeral/TTL data:
- `LOGIN_TOKENS`: magic-link token → email (TTL 15 min, single-use).
- `VIEWER_SESSIONS`: session id → user_id (TTL 30 days, sliding).

### Endpoints

**Ingest (device-token auth):**
- `POST /ingest` — body `{ sessions: [...] }`, validated with valibot. Resolve
  device→user from token. Upsert each row (`INSERT … ON CONFLICT … DO UPDATE`,
  batched in a D1 transaction). Update `devices.last_seen_at`. Per-device rate
  limit. Returns `{ upserted, skipped }`.

**Viewer auth (magic links):**
- `POST /auth/request` — `{ email }`. If email ∈ `allowed_emails`, mint login
  token in `LOGIN_TOKENS`, send magic link via Cloudflare Email Sending. Always
  returns 200 (no enumeration).
- `GET /auth/callback?token=…` — validate + consume token, create
  `VIEWER_SESSIONS` entry, set `HttpOnly; Secure; SameSite=Lax` cookie, redirect
  to dashboard.
- `POST /auth/logout` — delete session, clear cookie.

**Dashboard read API (viewer-session auth):**
- `GET /api/me` — current user (incl. `publicToGroup`) + their devices.
- `PATCH /api/me` `{ publicToGroup }` — toggle group sharing.
- `POST /api/devices` `{ label }` → mint device token (shown once).
- `DELETE /api/devices/:id` — revoke (set `revoked_at`).
- `GET /api/summary?from&to&source&device&scope=me|group` — rollups.
  - `scope=me`: full detail incl. **by project**, across the user's own devices.
  - `scope=group`: **overall only** — totals, per-day series, by source, by
    model, by device/person. **No per-project breakdown.**
- `GET /api/sessions?from&to&source&device&cursor` — paginated session rows for
  drill-down. **`scope=me` only**; never exposes other users' sessions.

### Read scope

Default `scope=me`: the logged-in user's own devices, full detail incl. project.
`scope=group`: aggregate across **only users who opted in** (`public_to_group =
1`), and **overall only** — no project names, no individual session rows leave a
user. Both are read-only and gated by a valid viewer session. A user always sees
their own full data regardless of their sharing setting.

### Email

Cloudflare Email Sending binding (Workers paid tier), sending **from
`no-reply@ethanchung.dev`** (domain `ethanchung.dev`, SPF/DKIM/DMARC configured
in Cloudflare). For a known allowlist, delivery to verified destination
addresses is acceptable. Implementation will follow the
`cloudflare:cloudflare-email-service` skill; if native send is insufficient,
fall back to a provider (Resend/MailChannels) behind the same `sendMagicLink()`
interface.

---

## Component 3: Dashboard (Astro)

- **Stack:** **Astro + Vite** + TypeScript, built to **static output** (no SSR)
  and served by the same Hono Worker via the Assets binding — same origin, no
  CORS, no second Worker. Charts via a lightweight lib (Recharts/`visx`/
  Chart.js) in interactive islands that fetch the JSON API.
- **Auth gate:** no viewer cookie → login screen (enter email → "check your
  inbox"). With cookie → dashboard.
- **Views:**
  - **Overview** — total tokens & cost over time (daily/weekly), date-range +
    source + device + scope (me/group) filters.
  - **By model / source** — breakdown bars.
  - **By project** — top projects by cost. **`scope=me` only** (hidden in group
    view).
  - **By device / person** — contribution split.
  - **Sessions** — sortable, filterable, paginated drill-down table.
    **`scope=me` only.**
- **Settings** — toggle **"Share my overall stats with the group"**
  (`publicToGroup`, default off).
- **Device management** — list devices, add (shows token once), revoke.

When `scope=group` is selected, the dashboard renders only the overall views
(overview, by model/source, by device/person across opted-in users) and hides
the project and session views.

---

## Error Handling

**Sync CLI:**
- Per-source failure (missing agent, parse error) → warn + skip, non-fatal.
- Network/5xx → retry with exponential backoff; exit non-zero so cron surfaces
  it. Delivered batches persist to `state.json`; undelivered retry next run.
- `401` → clear "re-enroll this device" message.
- Oversized payloads → chunked (500 sessions/request).

**Worker:**
- Validate every payload (valibot); reject malformed/oversized with 4xx.
- Per-device ingest rate limit.
- D1 upserts in a transaction per batch.
- Structured logging via Workers observability; no tokens/emails in logs.

---

## Testing

- **Sync CLI:** unit tests over mocked `ccusage session --json` fixtures (diff,
  chunking, redaction, state persistence). Integration test against
  `wrangler dev` + local D1.
- **Worker:** `@cloudflare/vitest-pool-workers` with migrations on a test D1.
  Cover upsert idempotency, ingest auth, magic-link issue/consume/expiry, scope
  isolation (me vs group), rate limiting.
- **Dashboard:** component tests for views; one smoke e2e of the login→overview
  path.

---

## Rollout Milestones

- **M1 — End-to-end push.** Worker + D1 schema + `POST /ingest` + manual device
  enrollment (seed row). Sync CLI MVP (claude source only). Prove a session row
  lands in D1.
- **M2 — Full sync + auth.** All sources, incremental `state.json`, chunking,
  retries. Magic-link login + viewer sessions + device management API.
- **M3 — Dashboard.** Astro app (Overview + Sessions table) on Cloudflare.
  Device add/revoke UI. Settings toggle for `publicToGroup`.
- **M4 — Polish.** Group scope (opt-in, overall-only), `--redact-projects`,
  remaining charts (by model/project/person), rate limiting, observability,
  docs + example cron.

## Open Questions (defer to implementation)

- Exact Cloudflare Email Sending quota/verification behavior on the paid tier —
  confirm against the email-service skill at M2; provider fallback ready.
- `model_breakdowns` JSON shape may differ slightly across sources — store
  verbatim as JSON; the dashboard tolerates missing keys.

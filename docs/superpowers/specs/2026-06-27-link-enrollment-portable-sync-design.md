# Link-based device enrollment + portable one-liner sync — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)

## Problem

Adding a device today is a multi-step, copy-paste-the-token chore that is not
portable across machines:

1. Build the CLI from the monorepo (not published anywhere).
2. Dashboard → Settings → "Add device" → copy a `cccloud_…` token (shown once).
3. On the machine: `ccusage-cloud login --server <url> --token <token>`.
4. `ccusage-cloud sync`.

The user wants a single shareable command — `curl`-style, working on both Linux
and Windows — that they can paste on any machine to enroll it and sync, without
manually handling a token. From the dashboard they want a **direct link** that
both registers a new device and lets that machine push stats.

## Constraints / reality check

- A pure `curl` cannot do the sync. The importer's job is to run `ccusage`
  locally and read its JSON output, so the one-liner is necessarily a
  **bootstrap installer** (`curl … | sh` on Linux/macOS, `irm … | iex` on
  Windows PowerShell) that sets up credentials and runs the real sync.
- Node ≥ 20 and `ccusage` on `PATH` are already hard requirements (ccusage
  itself needs Node), so the bootstrap does not try to remove the Node
  dependency.
- Existing stack: Hono on Cloudflare Workers, D1 (SQLite), KV (rate limiting),
  static dashboard (Astro) served via the `ASSETS` binding. Device tokens are
  stored as SHA-256 hashes; dashboard API is JWT-authed via an external gateway.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Link credential model | **One-time claim link** — link carries a short-lived, single-use enrollment code, not the device token. |
| One-liner scope | **Enroll + sync once.** No auto-scheduling; print a hint for cron / Task Scheduler. |
| CLI delivery | **Worker serves a bundled single-file CLI** (`/cli.js`). Self-hosted; nothing on npm. |
| Device naming | **Auto from hostname, lazy-create.** Generic enroll link; device row created at redemption with the machine's hostname as label; renamable later. |

## User-facing flow

1. Dashboard → Settings → **"Enroll a device"** button.
2. Worker mints a short-lived, single-use claim code. Dashboard shows two
   copy-paste one-liners with an expiry countdown:

   ```sh
   # Linux / macOS
   curl -fsSL "https://my-worker.dev/i.sh?c=ec_AbC123" | sh
   ```
   ```powershell
   # Windows (PowerShell)
   irm "https://my-worker.dev/i.ps1?c=ec_AbC123" | iex
   ```

3. User pastes on the target machine. The bootstrap:
   - verifies Node ≥ 20 (clear error + link if missing),
   - downloads `cli.js` from the same Worker into the config dir,
   - runs `node cli.js enroll --server <url> --code <code>` (auto-labels from
     hostname, writes config),
   - runs `node cli.js sync`,
   - prints how to schedule recurring syncs themselves.
4. The device appears in the dashboard, named after the machine's hostname.

The existing manual `login --token` flow remains as a fallback and is unchanged.

## Components

### 1. Claim codes (D1)

New table `enroll_codes`:

| Column | Type | Notes |
|---|---|---|
| `code_sha256` | TEXT PRIMARY KEY | SHA-256 of the plaintext code (hashed at rest, mirrors `devices.token_sha256`). |
| `user_id` | TEXT NOT NULL | References `users(id)`. |
| `created_at` | INTEGER NOT NULL | ms. |
| `expires_at` | INTEGER NOT NULL | ms; default now + 15 min. |
| `used_at` | INTEGER | null = unused; set on redemption. |

Plaintext code format: `ec_<base64url(random)>` via the existing `randomToken`
helper. Single-use: redemption sets `used_at`; a code that is used, expired, or
unknown → `410 Gone`. The code is only an exchange ticket — it is never a device
token.

### 2. Worker endpoints (Hono)

- `POST /api/enroll-codes` — **JWT-auth (dashboard viewer).** Inserts a new
  `enroll_codes` row, returns `{ code, expiresAt }`.
- `POST /api/enroll` — **public.** Body `{ code, label }`. Validates the code
  (exists, `used_at IS NULL`, not expired). On success: lazily creates a device
  (`dev_…` id + `cccloud_…` token, exactly like `POST /api/devices`) with the
  given `label`, marks the code used, returns `{ token, serverUrl }`. On
  failure: `410 Gone`. Rate-limited via the existing KV limiter.
- `GET /i.sh`, `GET /i.ps1` — **public**, dynamic routes. Return the bootstrap
  script with the server URL and the `?c=` code templated in, so the pasted
  command is fully self-contained. `Content-Type: text/plain`.
- `GET /cli.js` — the bundled CLI, served as a static asset (see below).

### 3. Bundled CLI delivery

- Add a tsup build target that bundles the CLI into a single self-contained
  `cli.js` (ESM, Node shebang).
- A build step copies it to `dashboard/dist/cli.js` so the existing `ASSETS`
  binding serves it at `/cli.js`. Version always matches the deployed Worker.

### 4. CLI change

One new subcommand, reusing existing config/sync code:

```
ccusage-cloud enroll --server <url> --code <code> [--ccusage-bin <path>] [--redact-projects]
```

- Reads the machine hostname (`os.hostname()`).
- `POST <server>/api/enroll` with `{ code, label: <hostname> }`.
- Writes the returned token via the existing `login` config writer to
  `~/.config/ccusage-cloud/config.json` (mode 0600).
- Exits non-zero with a clear message on `410`.

The bootstrap then invokes the existing `sync` command unchanged.

### 5. Bootstrap scripts (`i.sh`, `i.ps1`)

Each script:

1. Check Node ≥ 20 is on `PATH`; if not, print a short message + download link
   and exit.
2. Download `cli.js` from the Worker (`<server>/cli.js`) into the config dir.
3. `node cli.js enroll --server <server> --code <code>`.
4. `node cli.js sync`.
5. Print a scheduling hint (cron entry for Linux/macOS, `schtasks` for Windows).

No secret is baked into the served scripts beyond the one-time code the user
already pasted into their own command.

### 6. Dashboard change

Settings page (`SettingsDevices.tsx`) gains an **"Enroll a device"** action that:

- calls `POST /api/enroll-codes`,
- renders the two one-liners (sh + ps1) with copy buttons,
- shows an expiry countdown.

The existing manual "Add device" (label → token) flow is kept alongside it.

## Data flow

```
Dashboard (JWT) ──POST /api/enroll-codes──► Worker ──INSERT──► enroll_codes (hashed)
        ◄── { code, expiresAt } ──

User pastes:  curl .../i.sh?c=CODE | sh
  Machine ──GET /i.sh?c=CODE──► Worker (templated script)
  Machine ──GET /cli.js──────► Worker (ASSETS)
  Machine ──POST /api/enroll {code, label=hostname}──► Worker
              validate code → create device → mark used
        ◄── { token, serverUrl } ──  (saved to ~/.config/ccusage-cloud/config.json)
  Machine ──POST /ingest (Bearer token)──► Worker  (existing sync path)
```

## Error handling

- Invalid / expired / used claim code → `410 Gone`; CLI and bootstrap surface a
  clear "link expired, generate a new one" message.
- Missing Node → bootstrap prints install guidance and exits before any network
  download.
- `/api/enroll` is rate-limited (KV) to blunt code-guessing; codes are
  high-entropy and short-lived regardless.
- Existing `/ingest` retry/backoff behavior is unchanged.

## Security notes

- The claim code is single-use, short-lived (15 min), high-entropy, and stored
  only as a SHA-256 hash. It is an exchange ticket, never a long-lived secret.
- The permanent device token never appears in a URL, browser history, or shell
  history — it is returned over HTTPS to the machine and written to a 0600 file.
- `i.sh` / `i.ps1` / `cli.js` are public and contain no secrets.
- `curl … | sh` trust caveat applies, mitigated because the command targets only
  the user's own Worker over HTTPS and the script is short and auditable
  (fetchable without `| sh`).

## Out of scope (YAGNI)

- Auto-scheduling / cron or Task Scheduler installation.
- Publishing the CLI to npm.
- Prebuilt/compiled standalone binaries.
- Reusable multi-device enroll links — each link enrolls exactly one device.

## Testing

- **Worker:** unit tests for `enroll_codes` mint/redeem (happy path, expired,
  reused, unknown code), and that `/api/enroll` creates a device + marks the code
  used atomically. Auth tests: `/api/enroll-codes` requires JWT; `/api/enroll`
  does not.
- **CLI:** `enroll` writes config from a mocked `/api/enroll` response, uses
  hostname as label, and exits non-zero on `410`.
- **Bootstrap:** script-level smoke (Node-version gate, code/server templating);
  manual cross-platform check on Linux and Windows PowerShell.
- **Dashboard:** "Enroll a device" renders both one-liners and the countdown.
```

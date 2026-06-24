# ccusage-cloud

Aggregates per-device [ccusage](https://github.com/ryoppippi/ccusage) AI-usage stats into a private Cloudflare Worker and dashboard. **ccusage itself is never modified**; ccusage-cloud only reads its output via `ccusage <source> session --json`.

Key properties:

- **Private by default** — your Worker, your data; nothing goes to a shared service.
- **Multi-device** — run `ccusage-cloud sync` on each machine; the dashboard shows combined usage.
- **Opt-in group sharing** — share an overall cost/token total with others; no project names or per-session rows are ever exposed to group members.

---

## Prerequisites

| Requirement | Detail |
|---|---|
| Node.js | ≥ 20 |
| ccusage | Installed and on `PATH` (provides `ccusage <source> session --json`) |
| Deployed Worker | A ccusage-cloud Worker deployed to your Cloudflare account |
| Device token | Minted from the dashboard **Settings** page after deployment |

---

## Install

From the repo root (private monorepo, not published to npm):

```sh
pnpm install
cd cli && pnpm build
```

The built binary is `cli/bin/ccusage-cloud.js`. Add it to your `PATH` or use `node cli/bin/ccusage-cloud.js` in place of `ccusage-cloud` below.

---

## Usage

### `login` — save credentials

```sh
ccusage-cloud login --server <worker-url> --token <device-token> [--ccusage-bin <path>] [--redact-projects]
```

Saves `serverUrl`, `token`, `ccusageBin`, and (optionally) `redactProjects: true` to `~/.config/ccusage-cloud/config.json` (mode `0600`). You only need to run this once per device.

| Flag | Required | Description |
|---|---|---|
| `--server <url>` | yes | Base URL of your deployed Worker (e.g. `https://ccusage-cloud.example.workers.dev`) |
| `--token <token>` | yes | Device token from the dashboard Settings page |
| `--ccusage-bin <path>` | no | Path to the `ccusage` binary (default: `ccusage` from `PATH`) |
| `--redact-projects` | no | SHA-256-hash project paths before they leave the device (persisted to config) |

---

### `sync` — push sessions to the Worker

```sh
ccusage-cloud sync [--full] [--source <name>] [--redact-projects]
```

Reads sessions from all sources (or the specified source) via `ccusage <source> session --json`, diffs against incremental state at `~/.config/ccusage-cloud/state.json`, and pushes only changed sessions to the Worker.

| Flag | Description |
|---|---|
| `--full` | Ignore incremental state; push all sessions regardless of prior sync |
| `--source <name>` | Limit sync to one source (e.g. `claude`, `codex`); default is all sources |
| `--redact-projects` | Override the persisted setting for this run (SHA-256 project paths) |

**Default sources** (the `ALL_SOURCES` set):
`amp`, `claude`, `codebuff`, `codex`, `copilot`, `droid`, `gemini`, `goose`, `hermes`, `kilo`, `kimi`, `openclaw`, `opencode`, `pi`, `qwen`

Sources that produce no sessions or return an error are silently skipped.

---

### `status` — check local state

```sh
ccusage-cloud status
```

Prints the configured server URL, the ccusage binary in use, the last sync time, and how many sessions are pending upload. No data is sent.

---

## Scheduling

Run `sync` periodically so your dashboard stays current.

### cron (Linux / macOS)

Add to your crontab (`crontab -e`):

```cron
*/30 * * * * /usr/local/bin/ccusage-cloud sync
```

Adjust the path to match where the binary is installed.

### launchd (macOS)

Save as `~/Library/LaunchAgents/com.ccusage-cloud.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ccusage-cloud.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/ccusage-cloud</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/ccusage-cloud.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/ccusage-cloud.err</string>
</dict>
</plist>
```

Load it:

```sh
launchctl load ~/Library/LaunchAgents/com.ccusage-cloud.sync.plist
```

`StartInterval` is in seconds; `1800` = every 30 minutes.

---

## What data leaves your machine

Every `sync` call sends only the following fields per session to your private Worker:

| Field | Notes |
|---|---|
| Token counts | Input, output, cache tokens |
| Cost | USD cost reported by ccusage |
| Model name | e.g. `claude-opus-4-5` |
| Source name | e.g. `claude`, `codex` |
| Session ID | Opaque identifier from ccusage |
| Timestamp | Session start/end times |
| `projectPath` | The working directory of the session — **see below** |

**No prompt text, no response text, no file contents** ever leave the device. ccusage-cloud reads only the structured session JSON produced by `ccusage <source> session --json`.

### `projectPath` and `--redact-projects`

By default `projectPath` is sent as plain text (e.g. `/home/you/myproject`).

Pass `--redact-projects` on `login` to persist the setting, or on any `sync`/`status` invocation to apply it for that run. When enabled, each `projectPath` is replaced with its **SHA-256 hex digest** before it leaves the device. The digest is deterministic, so the dashboard can still group sessions by project without knowing the actual path; only you can reverse it by hashing the path locally.

The setting is stored in `~/.config/ccusage-cloud/config.json` so scheduled `sync` runs respect it without extra flags.

### Group sharing

Group sharing is **opt-in** and exposes only an **overall aggregate** (total tokens / cost). No project names, session rows, model breakdowns, or source names are shared with group members.

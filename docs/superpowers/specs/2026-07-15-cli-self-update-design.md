# CLI self-update in `sync` — design

Date: 2026-07-15
Status: Approved

## Problem

The CLI (`cli.js`) is downloaded to `${XDG_CONFIG_HOME:-~/.config}/ccusage-cloud/cli.js`
exactly once, during enrollment (the `i.sh` / `i.ps1` one-liner). After that, `sync`
runs that frozen local copy forever — there is no update path. When a fix ships (e.g.
the Windows libuv exit-crash fix on `master`), every device keeps running the old code
until the user manually re-downloads `cli.js`.

This spec adds a best-effort self-update to `sync`: after a successful sync, the real
CLI process refreshes its own `cli.js` from the server so the **next** sync runs the
new code.

## Goals

- Future CLI fixes propagate to devices automatically, with no user action.
- The update is silent unless it actually replaces the file (one line: `Updated CLI to latest.`).
- Self-update never breaks `sync`: any check/download/write failure is swallowed, and
  `sync`'s exit code is unaffected.
- Users who manage `cli.js` themselves can opt out.
- No worker code change required.

## Non-goals

- Applying the update to the *current* run (re-exec). Updates take effect next run.
- Retroactively fixing already-deployed buggy versions without one more run. A device
  on the current buggy `cli.js` will, on its next sync after the server is redeployed,
  download the fix (and crash once on exit while doing so); every sync after that is clean.
- Version pinning / rollback / channels.

## Key decisions

| Decision | Choice |
|----------|--------|
| When the update applies | **Next run.** Download to disk; current run keeps the already-loaded code. |
| Staleness detection | **Conditional GET + stored ETag.** `GET /cli.js` with `If-None-Match`; `304` = up to date. |
| Visibility | **Silent**, with a one-line notice only on an actual update. |
| Opt-out | `CCUSAGE_CLOUD_NO_SELF_UPDATE=1` disables it entirely. |
| ETag storage | A dedicated `cli.etag` file, isolated from `SyncState`. |
| Worker changes | **None** — Cloudflare `ASSETS` already serves `/cli.js` with an `ETag` and honors `If-None-Match`. |

## Architecture

### New module: `cli/src/selfupdate.ts`

A single, independently-testable function:

```ts
export interface SelfUpdateOpts {
  cliPath: string;          // the file to potentially replace (process.argv[1] in prod)
  fetchFn?: typeof fetch;   // injectable for tests
  configPath?: string;      // injectable for tests
  etagPath?: string;        // injectable for tests
}

export async function maybeSelfUpdate(opts: SelfUpdateOpts): Promise<boolean>;
```

Returns `true` iff it replaced the file. Logic:

1. If `process.env.CCUSAGE_CLOUD_NO_SELF_UPDATE` is set → return `false`.
2. If `basename(cliPath) !== 'cli.js'` → return `false`. This guards against ever
   overwriting anything but the bundled standalone (tests and `tsx`/`dist` dev runs have a
   different `argv[1]`, so they no-op).
3. `loadConfig(configPath)`; if not configured → return `false`.
4. Read the stored ETag (see below). `GET {serverUrl}/cli.js`, sending
   `If-None-Match: <etag>` when one is stored.
5. `304 Not Modified` → up to date → return `false`.
6. Non-2xx → swallow → return `false`.
7. `200`:
   - Read the body. If empty/blank → return `false` (never write an empty CLI).
   - If the body is byte-identical to the current `cliPath` contents → store the ETag,
     return `false` (no write). This makes the first-ever sync — where enrollment just
     downloaded the same file — a no-op write.
   - Otherwise write to `${cliPath}.tmp`, then `renameSync` over `cliPath` (atomic;
     Node's `fs.rename` replaces an existing target on Windows). Store the new ETag.
     `console.log('Updated CLI to latest.')`. Return `true`.

All of the above runs inside the caller's `try/catch` (see wiring); any thrown error
(network, fs, permissions) is ignored so `sync` is never affected.

### ETag persistence

A dedicated tiny store, **not** part of `SyncState` (so `syncOnce`'s state writes can
never clobber it, and self-update stays isolated):

- Path: `${XDG_CONFIG_HOME:-~/.config}/ccusage-cloud/cli.etag` (plain text, the raw ETag).
- `loadEtag(path?)` → `string | null` (missing file → `null`).
- `saveEtag(etag, path?)` → writes the file (`mkdir -p` the dir; `chmod 600` for
  consistency with `config.json` / `state.json`).

These live in `selfupdate.ts` (or a small `etag.ts`) — implementer's choice, kept local
to the feature.

### Wiring: `cli/src/index.ts`

`run()` stays pure (returns an exit code, no self-update) so every existing test is
untouched. Self-update is invoked only from the real `isMain` entry point, and only
after a clean `sync`:

```ts
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  run(argv)
    .then(async (code) => {
      if (code === 0 && argv[0] === 'sync') {
        const { maybeSelfUpdate } = await import('./selfupdate');
        await maybeSelfUpdate({ cliPath: process.argv[1] }).catch(() => {});
      }
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
```

Note this also carries the already-shipped exit fix: `process.exitCode = code` instead of
a synchronous `process.exit(code)` (which aborted on Windows with the libuv
`UV_HANDLE_CLOSING` assertion after `fetch`).

### Worker / deploy

No worker change. `worker/src/index.ts` serves `/cli.js` via the catch-all
`c.env.ASSETS.fetch(c.req.raw)`; Cloudflare static assets emit an `ETag` and return
`304` to `If-None-Match`. Implementation will verify a `HEAD`/`GET` on `/cli.js` returns
an `ETag` and that a matching `If-None-Match` yields `304`. If ASSETS ever fails to
`304`, the content-identical check on the `200` path still prevents redundant writes —
the feature degrades to "download-and-compare each sync", which is correct, just chattier.

## Data flow

```
node cli.js sync
  └─ run(['sync'])                 → pushes sessions + daily rows, returns 0
  └─ (isMain) maybeSelfUpdate()
       ├─ opt-out set?             → stop
       ├─ basename != cli.js?      → stop
       ├─ no config?               → stop
       ├─ GET /cli.js (If-None-Match: stored etag)
       │    ├─ 304                 → stop
       │    ├─ !ok                 → stop
       │    └─ 200
       │         ├─ empty body     → stop
       │         ├─ identical body → save etag, stop
       │         └─ different body → write tmp, rename over cli.js, save etag, log, done
       └─ (any throw)              → swallowed
  └─ process.exitCode = 0
```

## Error handling

- Every failure mode in `maybeSelfUpdate` returns `false` rather than throwing; the
  caller additionally wraps it in `.catch(() => {})` as a belt-and-suspenders guard.
- Writes are atomic (temp file + rename) so a crash mid-download never leaves a
  truncated `cli.js`.
- Empty-body and identical-body guards prevent writing a broken or pointlessly-churned file.

## Testing

Unit tests for `maybeSelfUpdate` using an injected `fetchFn` and temp `cliPath` /
`configPath` / `etagPath`:

1. `304` response → file unchanged, returns `false`.
2. `200` with new body → file replaced, ETag stored, returns `true`.
3. `200` with body identical to current file → no write, ETag stored, returns `false`.
4. `cliPath` basename is not `cli.js` → no network call, returns `false`.
5. `CCUSAGE_CLOUD_NO_SELF_UPDATE=1` → no network call, returns `false`.
6. No config present → returns `false`.
7. `fetchFn` throws / non-2xx → returns `false`, does not throw, file unchanged.
8. Stored ETag is sent as `If-None-Match` on the request.

Existing tests: unaffected, since `run()` is unchanged. The standalone `bundle.test.ts`
continues to validate the built `cli.js`.

## Rollout

1. Land this change; rebuild `dashboard/public/cli.js` (gitignored build artifact).
2. Redeploy the worker/dashboard so `/cli.js` serves the new bundle.
3. On each device's next `sync`, self-update fetches and installs the new `cli.js`; from
   then on, fixes propagate automatically. Devices currently on the buggy build crash
   once more on exit during that first fetch, then run clean.

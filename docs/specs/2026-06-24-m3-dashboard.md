# ccusage-cloud M3 — Dashboard (Milestone Spec)

**Date:** 2026-06-24
**Status:** Planned (forward note; full TDD plan via writing-plans before implementation)
**Builds on:** M1 + M2. Parent design: `2026-06-24-ccusage-cloud-design.md`.

> **⚠ Spec drift check — run BEFORE implementing this milestone.**
> Re-read the parent design spec, M2 spec, and the as-built M2 code, then verify:
> 1. **Auth surface** — `requireViewer` middleware and `/api/me`,
>    `/api/devices`, `PATCH /api/me` exist as M2 specified; the dashboard depends
>    on them.
> 2. **Data columns** — the `sessions` table columns the read API aggregates
>    (`source`, `models_used`, `project_path`, `total_cost`, `total_tokens`,
>    `last_activity`, `device_id`, `user_id`) still match the M1 migration.
> 3. **Single-Worker topology** — confirm the design's decision (Hono entry +
>    Astro static assets via `env.ASSETS`) is still the intended deployment; if
>    it changed to two Workers, this spec's serving model must change.
> If anything deviates, amend the spec and note the change before writing code.

## Goal

A logged-in viewer sees their own usage aggregated across all their devices,
can drill into sessions, manage devices, and toggle group sharing — served as a
static Astro app from the same Worker.

## Scope

### A. Read API (Worker)
1. `GET /api/summary?from&to&source&device&scope=me` (viewer-auth): returns
   rollups for the user's own devices — totals, per-day series, by source, by
   model, by project, by device. (`scope=group` lands in M4.)
2. `GET /api/sessions?from&to&source&device&cursor` (viewer-auth): paginated
   session rows for the drill-down table; `scope=me` only.
3. SQL aggregation helpers in `src/queries.ts` (grouped SUMs over `sessions`,
   scoped by `user_id`). `models_used` / `model_breakdowns` are JSON columns —
   aggregate by parsing or by joining a derived per-model rollup; choose at
   implementation and note the decision.

### B. Dashboard app (Astro)
4. New `dashboard/` Astro project (TypeScript), built to **static** output.
5. Worker serves the build via the **Assets binding** (`env.ASSETS.fetch`
   fallthrough for non-API paths). Add `assets` to `wrangler.jsonc` and a build
   step that outputs to the directory the Worker serves.
6. **Views:**
   - **Login gate** — no viewer cookie → email entry → "check your inbox".
   - **Overview** — tokens & cost over time, with date-range / source / device
     filters. Chart islands hydrate client-side and fetch `/api/summary`.
   - **By model / source** — breakdown bars.
   - **By project** — top projects by cost (`scope=me`).
   - **By device** — contribution split.
   - **Sessions** — sortable, filterable, paginated table from `/api/sessions`.
   - **Settings** — "Share my overall stats with the group" toggle →
     `PATCH /api/me`.
   - **Devices** — list / add (shows token once) / revoke, via `/api/devices`.
7. Charts via a lightweight lib (Recharts / `visx` / Chart.js) inside islands.

### C. Testing
8. Worker: aggregation query tests (seed sessions across 2 devices, assert
   `/api/summary` totals and groupings; assert cross-user isolation).
9. Dashboard: component tests for the table + filters; one smoke e2e of
   login → overview render.

## New / changed files (anticipated)

- Worker: `src/queries.ts`, `src/read_api.ts` (`/api/summary`, `/api/sessions`),
  `index.ts` (mount read API + assets fallthrough), `wrangler.jsonc` (`assets`).
- Dashboard: `dashboard/` (astro config, pages, island components, API client,
  chart components), root build wiring so `wrangler deploy` includes the build.

## Constraints carried from design

- Same origin (no CORS); dashboard is client-rendered (no SSR Worker).
- `scope=me` only in M3 — group aggregation and its overall-only restriction are
  M4. Do not expose other users' data in any M3 endpoint.

## Out of scope (M4)

- `scope=group` (opt-in, overall-only), `--redact-projects`, rate limiting,
  remaining "by person" charts, custom-domain deploy, example cron docs.

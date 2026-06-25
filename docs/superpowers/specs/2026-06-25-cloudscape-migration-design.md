# Cloudscape Migration Spec

**Date:** 2026-06-25
**Status:** Approved (design)
**Branch:** `feat/cloudscape-migration` (off `master`)
**Predecessor:** the validated throwaway spike on `spike/cloudscape-mockup`
(spec: `docs/superpowers/specs/2026-06-25-cloudscape-mockup-design.md`)

## Goal

Replace the dashboard's shadcn/Tailwind UI with the Cloudscape Design System on the
**real pages wired to live data**, retiring the old UI stack. The mockup proved the
look and feel and de-risked every page; this migration makes it the actual product.

## Decisions (from brainstorming)

1. **Build architecture:** stay on Astro static + React islands (proven by the
   mockup). Add Astro's `<ClientRouter />` (View Transitions) for smooth client-side
   navigation instead of full-document reloads. **Vite + React SPA is an explicit
   later phase**, not this one — it is the thing that removes the per-navigation
   shell re-hydration (see Known limitation).
2. **Cutover:** big-bang full replacement. All pages convert in this branch; the
   shadcn/Tailwind stack and the `/mockup` spike are deleted before merge. No
   mixed-styling period on `master`.
3. **Tests:** rewrite the per-component tests against the Cloudscape DOM, porting
   existing behavioral coverage. `lib/` unit tests and the `login-overview` e2e test
   stay and must keep passing.
4. **Login pages** are migrated to Cloudscape too (consistent look), preserving the
   magic-link flow.

## Scope

**In scope:** the `dashboard` package UI layer — layout, app shell, all six data
pages (Overview, Sources & Models, Projects, Devices, Sessions, Settings), the login
gate, the filter bar, loading/empty/error states, rewritten component tests, removal
of the old UI stack and the mockup spike.

**Out of scope / untouched:** `lib/api.ts` (all 8 endpoints), `lib/filters.ts`,
`lib/types.ts`; the `worker/` package; the `cli/` package; the D1 schema;
auth/worker behavior. The Vite + React SPA migration is a separate future effort.

Note: `lib/utils.ts` is only the shadcn `cn()` helper (`clsx` + `tailwind-merge`);
it becomes unused once Cloudscape replaces shadcn, so it is **removed** as part of
the stack removal (see below).

## Architecture & routing

- **Layout:** replace `src/layouts/Base.astro` with a Cloudscape layout that imports
  `@cloudscape-design/global-styles/index.css`, renders `<ClientRouter />` from
  `astro:transitions`, and does **not** import Tailwind's `global.css`.
- **Islands:** every page mounts its React island with `client:only="react"`
  (Cloudscape touches the DOM during render; no SSR).
- **App shell:** a real `AppShell` (React) adapted from the mockup's
  `CloudscapeShell` — `TopNavigation` + `AppLayout` + `SideNavigation` with the
  **real** routes (`/overview`, `/sources`, `/projects`, `/devices`, `/sessions`,
  `/settings`), the **Me/Group scope toggle wired to URL params** (via
  `lib/filters.ts`), and the existing **group-scope nav gating** (hide Projects +
  Sessions when scope is `group`). Replaces the current `src/components/AppShell.tsx`.

### Known limitation (accepted)

With `client:only` islands, each navigation re-hydrates the shell — `AppLayout`
re-mounts and transient UI state (e.g. nav-panel open/closed) resets per page.
`<ClientRouter />` removes the white-flash full reload and animates the swap, but the
truly persistent shell requires the deferred Vite + React SPA. Documented so the
follow-up phase has a clear charter.

## Pages & data wiring

Each data page keeps its **current data-fetching logic** — the `useEffect` +
`getMe`/`getSummary`/`getSessions` pattern, `readFiltersFromUrl`/`writeFiltersToUrl`,
and scope/group gating — and swaps only the presentation to Cloudscape, using the
mockup components as the blueprint.

| Page | Cloudscape build | Data |
|---|---|---|
| Overview | KPI `ColumnLayout`/`Box` + two `LineChart`s | `getSummary` totals + byDay |
| Sources & Models | two `BarChart`s + embedded `Table`s | `getSummary` bySource/byModel |
| Projects | sortable `collection-hooks` `Table` (group-gated) | `getSummary` byProject |
| Devices | `PieChart` + embedded `Table` | `getSummary` byDevice |
| Sessions | `Table` + `PropertyFilter` + "Load more" (group-gated) | `getSessions` (cursor) |
| Settings | `Toggle` + devices `Table` + add/revoke + token `Alert` | `getMe`/`patchMe`/`createDevice`/`deleteDevice`/`logout` |
| Login | `Container`/`Form`/`Input`/`Button` | `getMe` gate, `requestLogin` |

**New since the mockup (because data is now async):**

- **Loading/empty/error states.** Tables use Cloudscape `loading`/`empty`; charts
  use `statusType` (`loading`/`finished`). Fetch failures render an `Alert` or empty
  state. A failed `getMe` on a gated page follows the existing behavior (treat as
  unauthenticated / redirect to login where the current code does).
- **Filter bar** becomes Cloudscape `Select` (source/device) + `DateRangePicker`
  (from/to), writing through the existing `lib/filters.ts` helpers so URL state and
  scope behavior are unchanged.
- **Sessions pagination:** keep the **cursor-based "Load more"** `Button` (Cloudscape
  page-number `Pagination` does not fit a cursor API). `collection-hooks` provides
  client-side PropertyFilter/sort over the accumulated rows.
- **Settings** is wired to the **real** API (`patchMe`, `createDevice` reveals the
  one-time token in an `Alert`, `deleteDevice` revokes, `logout`).

## Removing the old stack

After all pages are converted and green:

- Delete: `src/components/ui/`, `src/styles/global.css`, `tailwind.config.ts`,
  `components.json`, `src/lib/utils.ts` (the now-unused `cn` helper), and the old
  shadcn components replaced in place.
- Delete the spike: `/mockup` pages, `src/components/mockup/`, and the spike
  `Cloudscape.astro` layout if it was carried over (the real layout supersedes it).
- Drop deps from `dashboard/package.json`: `tailwindcss`, `@tailwindcss/vite`,
  `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`,
  `@radix-ui/*`, `recharts`.
- Remove the Tailwind Vite plugin from `astro.config.mjs`.
- Add Cloudscape deps: `@cloudscape-design/components`,
  `@cloudscape-design/global-styles`, `@cloudscape-design/collection-hooks`.

## Testing

- **Rewrite** the per-component tests against the Cloudscape DOM, porting existing
  behavioral coverage: totals rendering, filter wiring, Me/Group scope gating
  (including the Projects/Sessions group notices), Sessions "Load more", device
  add/revoke, group-sharing toggle, and login states (checking → anon → sent →
  authenticated redirect).
- **Add a `window.matchMedia` polyfill** to `dashboard/vitest.setup.ts` alongside the
  existing `ResizeObserver` polyfill — Cloudscape `AppLayout` needs it under jsdom.
- **Unchanged and must stay green:** `lib/` unit tests (`api.test.ts`, filters) and
  the `login-overview` e2e test (update its selectors to the Cloudscape DOM where
  required, preserving the assertions).

## Sequencing (informs the plan, not binding)

1. Foundation: Cloudscape deps + layout (`<ClientRouter />`) + real `AppShell` +
   `matchMedia` polyfill + filter bar.
2–7. Convert each page (Overview, Sources, Projects, Devices, Sessions, Settings)
   with its rewritten tests, one page per task.
8. Login pages.
9. Delete the old stack + the `/mockup` spike; final build + full test suite green.

Big-bang merges to `master` only when the whole branch is green (build + all tests).

## Success criteria

- All real routes render in Cloudscape against live data; navigation is smooth via
  `<ClientRouter />`.
- No Tailwind/shadcn/recharts code or deps remain; no `/mockup` spike remains.
- `pnpm --filter dashboard build` succeeds; `lib/` tests, rewritten component tests,
  and the e2e test all pass.
- `worker/` and `cli/` untouched; the worker still serves the built dashboard.

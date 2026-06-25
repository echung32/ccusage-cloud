# Date-Range Filter & Test Tightening Spec

**Date:** 2026-06-25
**Status:** Approved (design)
**Branch:** `feat/date-range-filter` (off `master`, which now includes the merged
Cloudscape migration, PR #7)
**Predecessor:** `docs/superpowers/specs/2026-06-25-cloudscape-migration-design.md`
(the migration deferred the `DateRangePicker`; this closes that gap)

## Goal

Add the deferred Cloudscape `DateRangePicker` to the dashboard filter bar so the
`from`/`to` window is selectable in the UI (today it is only URL-settable), and
tighten the component test suite in two soft spots the migration review flagged.

## Decisions (from brainstorming)

1. **Range modes:** both **relative** (presets) and **absolute** (calendar) ranges.
2. **Granularity:** **day** (`dateOnly`); the data is bucketed by day.
3. **End boundary:** an end date `D` writes `to = ${D}T23:59:59.999Z` (**end of day**)
   so the worker's `last_activity <= to` includes the whole end day.
4. **Timezone:** day boundaries are treated as **UTC**, matching the worker's
   `substr(last_activity,1,10)` day bucketing. Accepted convention, documented.
5. **Process:** spec → plan → subagent-driven-development with **Codex as reviewer**
   (same pipeline as the migration).

## Scope

**In scope:** the `dashboard` package only —
- a new pure module `src/lib/daterange.ts` (range ⇄ filters conversion),
- `src/components/FilterBar.tsx` (add the `DateRangePicker`),
- `ariaLabel`s on the charts in `Overview.tsx`, `BySourceModel.tsx`, `ByDevice.tsx`,
- new/tightened component tests.

**Out of scope / untouched:** `src/lib/api.ts`, `src/lib/filters.ts`,
`src/lib/types.ts`; the `worker/` package; the `cli/` package; the D1 schema;
auth/worker behavior. No new runtime dependencies (`@cloudscape-design/components`
already provides `DateRangePicker` and `PropertyFilter`).

## Background: how `from`/`to` reach the data

`worker/src/queries.ts` filters sessions with lexicographic string comparison
against the `last_activity` TEXT column (ISO 8601):

```
if (f.from) parts.push('s.last_activity >= ?')   // inclusive lower bound
if (f.to)   parts.push('s.last_activity <= ?')   // inclusive upper bound
```

Consequences the picker must respect (the worker is off-limits, so the correctness
lives in `daterange.ts`):

- A bare `from = 2026-06-01` already includes the whole first day
  (`"2026-06-01T08:00:00Z" >= "2026-06-01"` lexicographically). We still normalise
  to `…T00:00:00.000Z` for symmetry and clarity.
- A bare `to = 2026-06-25` would **exclude** sessions later that day
  (`"2026-06-25T14:00:00Z" > "2026-06-25"`). We therefore write
  `to = 2026-06-25T23:59:59.999Z`.

## Part A — DateRangePicker

### `src/lib/daterange.ts` (new, pure, no DOM)

Two functions, the seam between Cloudscape's value shape and our `Filters`:

- **`rangeToFilters(value): { from?: string; to?: string }`**
  - `null` → `{}` (clears both `from` and `to`).
  - `{ type: 'absolute', startDate, endDate }` → `from = ${startDate}T00:00:00.000Z`,
    `to = ${endDate}T23:59:59.999Z`. `startDate`/`endDate` are `YYYY-MM-DD` under
    `dateOnly`.
  - `{ type: 'relative', amount, unit }` → resolve against the current time:
    `to` = end of **today** (`…T23:59:59.999Z`), `from` = start of the day that is
    `amount` × `unit` before today (`…T00:00:00.000Z`). Supports the `unit` values
    used by our presets (`day`, `week`, `month`). A relative value with a `key`
    matching a preset resolves identically via its `amount`/`unit`.
- **`filtersToRange(filters): DateRangePickerProps.Value | null`**
  - Neither `from` nor `to` present → `null`.
  - Otherwise reconstruct an **absolute** range from the date parts
    (`from`/`to` sliced to `YYYY-MM-DD`), filling a missing bound with the other so
    the picker always receives a complete absolute range to display.

Both functions are deterministic given an injected "now" (the relative branch takes
the current date; tests pass a fixed date) — keeps them unit-testable.

### `src/components/FilterBar.tsx`

Add a `DateRangePicker` field alongside the existing Source/Device `Select`s and the
`Clear` button:

- `relativeOptions`: **Last 7 days, Last 14 days, Last 30 days, Last 90 days**.
- `granularity` day / `dateOnly` so only calendar days are chosen.
- required `isValidRange` (reject incomplete ranges and inverted start/end) and
  `i18nStrings` (labels for the picker's controls).
- `value = filtersToRange(filters)`.
- `onChange`: `onChange({ ...filters, ...rangeToFilters(detail.value) })`.

The existing **Clear** button keeps doing `onChange({})`, which already clears
`from`/`to` along with everything else — no change needed there.

### Round-trip behavior (documented limitation)

`from`/`to` persist to the URL as ISO strings through the existing
`writeFiltersToUrl`. A **relative** pick is stored as its **resolved absolute
window**; on reload the picker shows that absolute range, not the original preset.
This is standard for URL-snapshot filters and is accepted.

## Part B — Test tightening

- **`daterange.ts` unit tests** (new): absolute → `from`/`to` with the
  start-of-day / end-of-day boundaries; relative → window computed from a fixed
  injected "now"; `null` → `{}`; `filtersToRange` round-trip (absolute in →
  `from`/`to` out → same absolute range back); single-bound reconstruction.
- **SessionsTable:** add a test asserting the `PropertyFilter` renders with its
  i18n labels and that entering a filter narrows the visible rows (today's tests
  only cover row rendering and group-scope gating).
- **Chart components** (`Overview`, `BySourceModel`, `ByDevice`): give each chart an
  `ariaLabel`, then tighten the tests to assert the **chart** renders (queried by
  that label) — not only numeric text that also appears in the embedded data table,
  which can pass even when the chart fails. Exact queries are finalised against the
  real jsdom DOM during TDD.

## Testing notes

- `dashboard/vitest.setup.ts` already polyfills `ResizeObserver` and
  `window.matchMedia`; `DateRangePicker`/`PropertyFilter` need no new polyfills.
- **Must stay green:** all existing `dashboard` unit tests, the `lib/` tests, and the
  `login-overview` e2e test.

## Success criteria

- The filter bar shows a working `DateRangePicker` (relative + absolute, day
  granularity); selecting a range updates `from`/`to`, drives the data fetch, and
  round-trips through the URL.
- End-of-day `to` is verified: a session at `…T23:00:00Z` on the end date is
  included.
- `daterange.ts` is covered by unit tests; SessionsTable `PropertyFilter` and the
  three charts have tightened assertions.
- `pnpm --filter dashboard build` succeeds; the full dashboard test suite, `lib/`
  tests, and the e2e test all pass.
- `worker/`, `cli/`, and `lib/{api,filters,types}.ts` are untouched.

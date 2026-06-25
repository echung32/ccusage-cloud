# Date-Range Filter & Test Tightening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the deferred Cloudscape `DateRangePicker` to the dashboard filter bar (relative + absolute, day granularity) and tighten two soft spots in the component test suite.

**Architecture:** A new pure module `src/lib/daterange.ts` is the seam between Cloudscape's `DateRangePickerProps.Value` and our `Filters` (`from`/`to` ISO strings). `FilterBar.tsx` renders the picker and routes its value through that seam into the existing `onChange`/`writeFiltersToUrl` flow — no data-fetching or worker change. Test tightening adds `daterange` unit tests, a `PropertyFilter` `i18nStrings` prop + assertion, and chart-presence assertions.

**Tech Stack:** Astro 5 + React islands, `@cloudscape-design/components` (already provides `DateRangePicker` + `PropertyFilter`), Vitest + Testing Library + jsdom.

## Global Constraints

- **Off-limits — do not modify:** `worker/` (any file), `cli/` (any file), `dashboard/src/lib/api.ts`, `dashboard/src/lib/filters.ts`, `dashboard/src/lib/types.ts`, the D1 schema/migrations.
- **No new runtime dependencies.** `DateRangePicker` and `PropertyFilter` ship in the already-installed `@cloudscape-design/components`.
- **Date convention:** day boundaries are UTC. Lower bound `from = ${YYYY-MM-DD}T00:00:00.000Z`; upper bound `to = ${YYYY-MM-DD}T23:59:59.999Z` (end-of-day, so the worker's `last_activity <= to` includes the whole end day).
- **`rangeToFilters` always returns both keys** (`from` and `to`), set to `undefined` when cleared, so a spread merge overwrites stale values.
- **Must stay green:** every existing `dashboard` unit test, the `lib/` tests, and the `e2e/login-overview` test.
- **Commit messages** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run tests with `pnpm --filter dashboard test` (Vitest) and build with `pnpm --filter dashboard build`.

---

### Task 1: `daterange.ts` conversion module

**Files:**
- Create: `dashboard/src/lib/daterange.ts`
- Test: `dashboard/src/lib/__tests__/daterange.test.ts`

**Interfaces:**
- Consumes: `DateRangePickerProps` from `@cloudscape-design/components/date-range-picker`.
- Produces (used by Task 2):
  - `rangeToFilters(value: DateRangePickerProps.Value | null, now?: Date): { from?: string; to?: string }`
  - `filtersToRange(filters: { from?: string; to?: string }): DateRangePickerProps.Value | null`

- [ ] **Step 1: Write the failing tests**

```ts
// dashboard/src/lib/__tests__/daterange.test.ts
import { describe, expect, it } from 'vitest';
import { rangeToFilters, filtersToRange } from '../daterange';

const NOW = new Date('2026-06-25T12:00:00.000Z');

describe('rangeToFilters', () => {
  it('maps an absolute range to start-of-day / end-of-day ISO bounds', () => {
    expect(rangeToFilters({ type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-25' })).toEqual({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-25T23:59:59.999Z',
    });
  });

  it('always makes the upper bound end-of-day so the end date is inclusive', () => {
    const { to } = rangeToFilters({ type: 'absolute', startDate: '2026-06-25', endDate: '2026-06-25' });
    expect(to).toBe('2026-06-25T23:59:59.999Z');
  });

  it('resolves a relative day range against the injected now', () => {
    expect(rangeToFilters({ type: 'relative', amount: 7, unit: 'day', key: 'last-7-days' }, NOW)).toEqual({
      from: '2026-06-18T00:00:00.000Z',
      to: '2026-06-25T23:59:59.999Z',
    });
  });

  it('clears both bounds for a null value', () => {
    expect(rangeToFilters(null)).toEqual({ from: undefined, to: undefined });
  });
});

describe('filtersToRange', () => {
  it('returns null when neither bound is set', () => {
    expect(filtersToRange({})).toBeNull();
  });

  it('reconstructs an absolute range from ISO bounds (round-trip)', () => {
    const filters = rangeToFilters({ type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-25' });
    expect(filtersToRange(filters)).toEqual({ type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-25' });
  });

  it('fills a missing bound with the present one', () => {
    expect(filtersToRange({ from: '2026-06-01T00:00:00.000Z' })).toEqual({
      type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-01',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter dashboard test src/lib/__tests__/daterange.test.ts`
Expected: FAIL — cannot resolve module `../daterange`.

- [ ] **Step 3: Write the implementation**

```ts
// dashboard/src/lib/daterange.ts
import type { DateRangePickerProps } from '@cloudscape-design/components/date-range-picker';

type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const MS: Record<'second' | 'minute' | 'hour' | 'day' | 'week', number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

function startOfDayUtc(d: Date): string {
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function endOfDayUtc(d: Date): string {
  return `${d.toISOString().slice(0, 10)}T23:59:59.999Z`;
}

function subtract(now: Date, amount: number, unit: TimeUnit): Date {
  if (unit === 'month') {
    const d = new Date(now.getTime());
    d.setUTCMonth(d.getUTCMonth() - amount);
    return d;
  }
  if (unit === 'year') {
    const d = new Date(now.getTime());
    d.setUTCFullYear(d.getUTCFullYear() - amount);
    return d;
  }
  return new Date(now.getTime() - amount * MS[unit]);
}

export function rangeToFilters(
  value: DateRangePickerProps.Value | null,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (!value) return { from: undefined, to: undefined };
  if (value.type === 'absolute') {
    return {
      from: `${value.startDate.slice(0, 10)}T00:00:00.000Z`,
      to: `${value.endDate.slice(0, 10)}T23:59:59.999Z`,
    };
  }
  // relative
  const from = subtract(now, value.amount, value.unit as TimeUnit);
  return { from: startOfDayUtc(from), to: endOfDayUtc(now) };
}

export function filtersToRange(
  filters: { from?: string; to?: string },
): DateRangePickerProps.Value | null {
  const fromDay = filters.from?.slice(0, 10);
  const toDay = filters.to?.slice(0, 10);
  if (!fromDay && !toDay) return null;
  return { type: 'absolute', startDate: fromDay ?? toDay!, endDate: toDay ?? fromDay! };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter dashboard test src/lib/__tests__/daterange.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/daterange.ts dashboard/src/lib/__tests__/daterange.test.ts
git commit -m "feat(dashboard): add daterange range<->filters conversion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire `DateRangePicker` into `FilterBar`

**Files:**
- Modify: `dashboard/src/components/FilterBar.tsx`
- Test: `dashboard/src/components/__tests__/filterbar.test.tsx`

**Interfaces:**
- Consumes: `rangeToFilters`, `filtersToRange` from `@/lib/daterange` (Task 1).
- Produces: unchanged `FilterBar` props (`filters`, `sources`, `devices`, `onChange`).

- [ ] **Step 1: Write the failing test (additive — keep the existing two tests)**

Add these to `dashboard/src/components/__tests__/filterbar.test.tsx`:

```tsx
it('renders the date-range control', () => {
  render(<FilterBar filters={{}} sources={[]} devices={[]} onChange={vi.fn()} />);
  // The DateRangePicker trigger exposes the placeholder text until a range is chosen.
  expect(screen.getByText('Filter by date range')).toBeInTheDocument();
});

it('reflects an active range from filters on the trigger', () => {
  render(<FilterBar filters={{ from: '2026-06-01T00:00:00.000Z', to: '2026-06-25T23:59:59.999Z' }} sources={[]} devices={[]} onChange={vi.fn()} />);
  // Cloudscape renders the selected absolute range on the trigger button.
  expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();
  expect(screen.getByText(/2026-06-25/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter dashboard test src/components/__tests__/filterbar.test.tsx`
Expected: the two new tests FAIL (no date-range control yet); the existing two PASS.

Note: if Cloudscape renders the trigger text differently under jsdom (e.g. the date format), inspect the actual DOM during this RED step and adjust the queries to match the real rendering — assert that the trigger and the active range are present, not a specific string format you cannot verify.

- [ ] **Step 3: Implement — add the picker to `FilterBar.tsx`**

Add imports at the top:

```tsx
import DateRangePicker, { type DateRangePickerProps } from '@cloudscape-design/components/date-range-picker';
import { rangeToFilters, filtersToRange } from '@/lib/daterange';
```

Add these module-level consts above the `FilterBar` function:

```tsx
const relativeOptions: DateRangePickerProps.RelativeOption[] = [
  { key: 'last-7-days', amount: 7, unit: 'day', type: 'relative' },
  { key: 'last-14-days', amount: 14, unit: 'day', type: 'relative' },
  { key: 'last-30-days', amount: 30, unit: 'day', type: 'relative' },
  { key: 'last-90-days', amount: 90, unit: 'day', type: 'relative' },
];

const isValidRange: DateRangePickerProps['isValidRange'] = (range) => {
  if (!range || range.type !== 'absolute') return { valid: true };
  if (!range.startDate || !range.endDate) return { valid: false, errorMessage: 'Select a start and end date.' };
  if (range.startDate > range.endDate) return { valid: false, errorMessage: 'The start date must be before the end date.' };
  return { valid: true };
};

const dateRangeI18n: DateRangePickerProps.I18nStrings = {
  todayAriaLabel: 'Today',
  nextMonthAriaLabel: 'Next month',
  previousMonthAriaLabel: 'Previous month',
  customRelativeRangeOptionLabel: 'Custom range',
  customRelativeRangeOptionDescription: 'Set a custom range',
  customRelativeRangeUnitLabel: 'unit of time',
  customRelativeRangeDurationLabel: 'Duration',
  formatRelativeRange: (e) => `Last ${e.amount} ${e.unit}${e.amount === 1 ? '' : 's'}`,
  relativeModeTitle: 'Relative range',
  absoluteModeTitle: 'Absolute range',
  relativeRangeSelectionHeading: 'Choose a range',
  startDateLabel: 'Start date',
  endDateLabel: 'End date',
  clearButtonLabel: 'Clear',
  cancelButtonLabel: 'Cancel',
  applyButtonLabel: 'Apply',
};
```

Inside the returned `SpaceBetween`, add a `FormField` for the picker (place it after the Device field, before the Clear field):

```tsx
<FormField label="Date range">
  <DateRangePicker
    value={filtersToRange(filters)}
    onChange={({ detail }) => onChange({ ...filters, ...rangeToFilters(detail.value) })}
    relativeOptions={relativeOptions}
    isValidRange={isValidRange}
    i18nStrings={dateRangeI18n}
    dateOnly
    placeholder="Filter by date range"
  />
</FormField>
```

- [ ] **Step 4: Run the full FilterBar suite to verify all pass**

Run: `pnpm --filter dashboard test src/components/__tests__/filterbar.test.tsx`
Expected: all four tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/FilterBar.tsx dashboard/src/components/__tests__/filterbar.test.tsx
git commit -m "feat(dashboard): add date-range picker to the filter bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `PropertyFilter` i18nStrings on the Sessions table

**Files:**
- Modify: `dashboard/src/components/SessionsTable.tsx`
- Test: `dashboard/src/components/__tests__/sessionstable.test.tsx`

**Interfaces:**
- Consumes: existing `propertyFilterProps` from `useCollection` (unchanged).
- Produces: nothing new for other tasks.

Context: `SessionsTable.tsx` already renders `<PropertyFilter {...propertyFilterProps} filteringPlaceholder="Filter sessions" countText={...} />` but passes **no `i18nStrings`**, so its operator/control labels are unlabeled. Add a complete `i18nStrings` and assert it is applied.

- [ ] **Step 1: Write the failing test (additive — keep the existing two tests)**

Add to `dashboard/src/components/__tests__/sessionstable.test.tsx`:

```tsx
it('renders the property filter with accessible labels', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ sessions: [{ source: 'claude-code', sessionId: 'abc', deviceId: 'd1', totalTokens: 100, totalCost: 0.5, firstActivity: null, lastActivity: '2026-06-24T10:00:00Z', modelsUsed: ['claude-opus-4-8'], projectPath: '/p' }], nextCursor: null }), { status: 200 }));
  }));
  render(<SessionsTable />);
  await waitFor(() => expect(screen.getByText('abc')).toBeInTheDocument());
  // i18nStrings.filteringAriaLabel is applied to the search input.
  expect(screen.getByLabelText('Find sessions')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter dashboard test src/components/__tests__/sessionstable.test.tsx`
Expected: the new test FAILS (no element labeled "Find sessions"); the existing two PASS.

Note: confirm during RED which attribute Cloudscape exposes `filteringAriaLabel` on; if `getByLabelText` does not match under jsdom, query the input by its `aria-label` directly (`screen.getByRole('combobox', { name: 'Find sessions' })` or `container.querySelector('[aria-label="Find sessions"]')`) — assert the label from `i18nStrings` reaches the DOM.

- [ ] **Step 3: Implement — add `i18nStrings` to the `PropertyFilter`**

In `SessionsTable.tsx`, add this module-level const near `filteringProperties`:

```tsx
const propertyFilterI18n = {
  filteringAriaLabel: 'Find sessions',
  dismissAriaLabel: 'Dismiss',
  filteringPlaceholder: 'Filter sessions',
  groupValuesText: 'Values',
  groupPropertiesText: 'Properties',
  operatorsText: 'Operators',
  operationAndText: 'and',
  operationOrText: 'or',
  operatorLessText: 'Less than',
  operatorLessOrEqualText: 'Less than or equal',
  operatorGreaterText: 'Greater than',
  operatorGreaterOrEqualText: 'Greater than or equal',
  operatorContainsText: 'Contains',
  operatorDoesNotContainText: 'Does not contain',
  operatorEqualsText: 'Equals',
  operatorDoesNotEqualText: 'Does not equal',
  editTokenHeader: 'Edit filter',
  propertyText: 'Property',
  operatorText: 'Operator',
  valueText: 'Value',
  cancelActionText: 'Cancel',
  applyActionText: 'Apply',
  allPropertiesLabel: 'All properties',
  tokenLimitShowMore: 'Show more',
  tokenLimitShowFewer: 'Show fewer',
  clearFiltersText: 'Clear filters',
  removeTokenButtonAriaLabel: () => 'Remove token',
  enteredTextLabel: (text: string) => `Use: "${text}"`,
} as const;
```

Then pass it to the `PropertyFilter` (keep the existing `filteringPlaceholder` and `countText`):

```tsx
filter={<PropertyFilter {...propertyFilterProps} i18nStrings={propertyFilterI18n} filteringPlaceholder="Filter sessions" countText={`${filteredItemsCount} matches`} />}
```

- [ ] **Step 4: Run the full SessionsTable suite to verify all pass**

Run: `pnpm --filter dashboard test src/components/__tests__/sessionstable.test.tsx`
Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/SessionsTable.tsx dashboard/src/components/__tests__/sessionstable.test.tsx
git commit -m "test(dashboard): add PropertyFilter i18nStrings and coverage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tighten chart-presence assertions

**Files:**
- Test: `dashboard/src/components/__tests__/overview.test.tsx`
- Test: `dashboard/src/components/__tests__/bysourcemodel.test.tsx`
- Test: `dashboard/src/components/__tests__/bydevice.test.tsx`

**Interfaces:** none — test-only. The chart components already set `ariaLabel`:
`Overview` LineCharts → `"Tokens over time"`, `"Cost over time"`;
`BySourceModel` BarCharts → `"Cost by source"`, `"Cost by model"`;
`ByDevice` PieChart → `"Device contribution by cost"`.

Goal: each chart test currently asserts only numeric/table text that also appears in the embedded data table, so it can pass even if the chart fails to render. Add an assertion that the **chart** is present, queried by its `ariaLabel`.

- [ ] **Step 1: Add the chart-presence assertion to `overview.test.tsx`**

In the existing `renders headline totals from the summary` test, after the current assertions add:

```tsx
expect(screen.getByLabelText('Tokens over time')).toBeInTheDocument();
expect(screen.getByLabelText('Cost over time')).toBeInTheDocument();
```

- [ ] **Step 2: Run to confirm the query matches the real DOM**

Run: `pnpm --filter dashboard test src/components/__tests__/overview.test.tsx`
Expected: PASS. If `getByLabelText` does not match the chart's `ariaLabel` under jsdom, inspect the rendered DOM and switch to the query that does (e.g. `getByRole('img', { name: 'Tokens over time' })`, `getByRole('group', { name: ... })`, or `container.querySelector('[aria-label="Tokens over time"]')`). The assertion must confirm the chart element (not the embedded table) rendered. Apply the same resolved query style in Steps 3-4.

- [ ] **Step 3: Add chart-presence assertions to `bysourcemodel.test.tsx`**

In the test that renders the summary, after the existing assertions add (using the query style confirmed in Step 2):

```tsx
expect(screen.getByLabelText('Cost by source')).toBeInTheDocument();
expect(screen.getByLabelText('Cost by model')).toBeInTheDocument();
```

If this test file does not already render `BySourceModel` with non-empty `bySource`/`byModel`, ensure the mocked summary includes at least one row in each so the chart has data to render; mirror the existing fetch-mock pattern in the file.

- [ ] **Step 4: Add the chart-presence assertion to `bydevice.test.tsx`**

After the existing assertions add (using the confirmed query style):

```tsx
expect(screen.getByLabelText('Device contribution by cost')).toBeInTheDocument();
```

Ensure the mocked summary includes at least one `byDevice` row so the pie chart renders.

- [ ] **Step 5: Run all three chart suites to verify they pass**

Run: `pnpm --filter dashboard test src/components/__tests__/overview.test.tsx src/components/__tests__/bysourcemodel.test.tsx src/components/__tests__/bydevice.test.tsx`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/__tests__/overview.test.tsx dashboard/src/components/__tests__/bysourcemodel.test.tsx dashboard/src/components/__tests__/bydevice.test.tsx
git commit -m "test(dashboard): assert charts render distinctly from their tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the complete dashboard test suite**

Run: `pnpm --filter dashboard test`
Expected: all unit + component tests PASS, including the unchanged `lib/` and `e2e/login-overview` tests.

- [ ] **Step 2: Build the dashboard**

Run: `pnpm --filter dashboard build`
Expected: build succeeds, all pages emitted.

- [ ] **Step 3: Confirm off-limits files are untouched**

Run: `git diff --name-only master...HEAD`
Expected: only files under `dashboard/src/lib/daterange.ts`, `dashboard/src/lib/__tests__/daterange.test.ts`, `dashboard/src/components/FilterBar.tsx`, `dashboard/src/components/SessionsTable.tsx`, the four touched test files, and the `docs/` spec + plan. No `worker/`, `cli/`, `api.ts`, `filters.ts`, or `types.ts` changes.

---

## Self-Review

- **Spec coverage:** DateRangePicker (relative + absolute, day, end-of-day) → Tasks 1-2. `daterange` unit tests → Task 1. PropertyFilter i18nStrings + coverage → Task 3. Chart-vs-table assertions → Task 4. Build + suite green + off-limits untouched → Task 5. All spec items mapped.
- **Placeholder scan:** none — every code/step is concrete. The two "if the DOM differs" notes are explicit TDD-RED discovery instructions, not deferred work.
- **Type consistency:** `rangeToFilters`/`filtersToRange` signatures match between Task 1 (produced) and Task 2 (consumed); both return/accept `{ from?: string; to?: string }` and `DateRangePickerProps.Value | null`.

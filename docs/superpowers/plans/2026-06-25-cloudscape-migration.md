# Cloudscape Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's shadcn/Tailwind UI with Cloudscape on the real, live-data pages and retire the old stack.

**Architecture:** Astro static + React islands (kept). A new `Dashboard.astro` layout loads Cloudscape global styles and Astro's `<ClientRouter />` for smooth client-side navigation. A real `AppShell` (Cloudscape `TopNavigation`+`AppLayout`+`SideNavigation`) wraps each page. Each page keeps its existing data-fetching logic and swaps presentation to Cloudscape. The shadcn/Tailwind/recharts stack is deleted at the end. Vite+React SPA is a deferred follow-up.

**Tech Stack:** Astro 5, `@astrojs/react`, React 19, `@cloudscape-design/components`, `@cloudscape-design/global-styles`, `@cloudscape-design/collection-hooks`, Vitest + Testing Library.

## Global Constraints

- Do NOT modify `worker/`, `cli/`, `dashboard/src/lib/api.ts`, `dashboard/src/lib/filters.ts`, or `dashboard/src/lib/types.ts`.
- Cloudscape imports use submodule paths (e.g. `@cloudscape-design/components/button`).
- Page islands mount with `client:only="react"` (Cloudscape touches the DOM; no SSR).
- The Cloudscape layout must NOT import Tailwind's `src/styles/global.css`.
- Charts use the built-in `@cloudscape-design/components/{line,bar,pie}-chart` (NOT `@cloudscape-design/chart-components`).
- Scope/group behavior is unchanged: `scope=group` hides Projects + Sessions nav and those two pages show a "switch to Me" notice and issue NO data fetch.
- Formatters live in `dashboard/src/lib/format.ts` (Task 1): `fmtInt` (`toLocaleString('en-US')`), `fmtUsd` (`$` + `toFixed(2)`), `fmtTime`.
- Token counts are comma-formatted via `fmtInt` — tests asserting token strings must expect the formatted value (e.g. `1,000`, not `1000`).
- TDD: write the failing test first. Cloudscape's rendered DOM may differ from shadcn (e.g. a `Toggle` may expose role `checkbox` not `switch`; a `Button`/nav item with `href` renders as role `link`). If a query doesn't match in the RED phase, inspect the rendered output (`screen.debug()`) and adjust the **query** — never weaken the behavioral assertion.
- Test fetch mocking pattern (from existing tests): `vi.stubGlobal('fetch', vi.fn().mockImplementation((url, init) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))))`, routed by `url.startsWith(...)`; `afterEach(() => vi.restoreAllMocks())`.

---

### Task 1: Foundation — deps, formatters, layout, test polyfill

**Files:**
- Modify: `dashboard/package.json` (add Cloudscape deps only)
- Create: `dashboard/src/lib/format.ts`
- Create: `dashboard/src/layouts/Dashboard.astro`
- Modify: `dashboard/vitest.setup.ts`
- Test: `dashboard/src/lib/__tests__/format.test.ts`

**Interfaces:**
- Produces: `fmtInt(n: number): string`, `fmtUsd(n: number): string`, `fmtTime(s: string | null): string`; a `Dashboard.astro` layout accepting `title?: string` with a `<slot/>`.

- [ ] **Step 1: Install Cloudscape packages**

Run: `pnpm --filter dashboard add @cloudscape-design/components @cloudscape-design/global-styles @cloudscape-design/collection-hooks`
Expected: the three appear under `dependencies`. React-19 peer warnings are acceptable; do not change React.

- [ ] **Step 2: Write the failing formatter test**

Create `dashboard/src/lib/__tests__/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fmtInt, fmtUsd, fmtTime } from '../format';

describe('format', () => {
  it('formats integers with grouping', () => { expect(fmtInt(1000)).toBe('1,000'); expect(fmtInt(465)).toBe('465'); });
  it('formats USD to 2 dp', () => { expect(fmtUsd(3.5)).toBe('$3.50'); });
  it('formats time and null', () => {
    expect(fmtTime('2026-06-24T09:02:00Z')).toBe('2026-06-24 09:02:00 UTC');
    expect(fmtTime(null)).toBe('—');
  });
});
```

- [ ] **Step 3: Run it (RED)** — `pnpm --filter dashboard test format` → FAIL (module not found).

- [ ] **Step 4: Create the formatters**

Create `dashboard/src/lib/format.ts`:
```ts
export const fmtInt = (n: number) => n.toLocaleString('en-US');
export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
export const fmtTime = (s: string | null) => (s ? s.replace('T', ' ').replace('Z', ' UTC') : '—');
```

- [ ] **Step 5: Run it (GREEN)** — `pnpm --filter dashboard test format` → PASS.

- [ ] **Step 6: Create the Cloudscape layout**

Create `dashboard/src/layouts/Dashboard.astro`:
```astro
---
import '@cloudscape-design/global-styles/index.css';
import { ClientRouter } from 'astro:transitions';
interface Props { title?: string }
const { title = 'ccusage-cloud' } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <ClientRouter />
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 7: Add the matchMedia polyfill**

Modify `dashboard/vitest.setup.ts` — append after the existing `ResizeObserver` block:
```ts
// Cloudscape AppLayout reads window.matchMedia, absent in jsdom
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }) as unknown as MediaQueryList;
}
```

- [ ] **Step 8: Verify build** — `pnpm --filter dashboard build` → succeeds (existing pages still use `Base.astro`; nothing references `Dashboard.astro` yet).

- [ ] **Step 9: Commit**
```bash
git add dashboard/package.json pnpm-lock.yaml dashboard/src/lib/format.ts dashboard/src/lib/__tests__/format.test.ts dashboard/src/layouts/Dashboard.astro dashboard/vitest.setup.ts
git commit -m "feat(dashboard): Cloudscape foundation — deps, layout, formatters, test polyfill"
```

---

### Task 2: AppShell (Cloudscape)

Replaces the shadcn `AppShell`. Same public API and scope behavior so pages need no signature change.

**Files:**
- Modify (full rewrite): `dashboard/src/components/AppShell.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/appshell.test.tsx`

**Interfaces:**
- Produces: `AppShell({ active, scope, children }: { active: string; scope?: 'me' | 'group'; children: ReactNode })`.
- Consumes: nothing from later tasks.

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/appshell.test.tsx` with:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../AppShell';

describe('AppShell scope', () => {
  it('shows Projects and Sessions nav in me scope', () => {
    render(<AppShell active="/overview" scope="me"><div /></AppShell>);
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument();
  });
  it('hides Projects and Sessions nav in group scope', () => {
    render(<AppShell active="/overview" scope="group"><div /></AppShell>);
    expect(screen.queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sessions' })).not.toBeInTheDocument();
  });
  it('renders a me/group toggle as links', () => {
    render(<AppShell active="/overview" scope="me"><div /></AppShell>);
    expect(screen.getByRole('link', { name: /group/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test appshell` → FAIL (queries may also fail on the old DOM differently; the new component drives them green).

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/AppShell.tsx` with:
```tsx
import { useState, type ReactNode } from 'react';
import AppLayout from '@cloudscape-design/components/app-layout';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import SideNavigation from '@cloudscape-design/components/side-navigation';

const NAV = [
  { type: 'link' as const, text: 'Overview', href: '/overview' },
  { type: 'link' as const, text: 'Sources & Models', href: '/sources' },
  { type: 'link' as const, text: 'Projects', href: '/projects' },
  { type: 'link' as const, text: 'Devices', href: '/devices' },
  { type: 'link' as const, text: 'Sessions', href: '/sessions' },
  { type: 'link' as const, text: 'Settings', href: '/settings' },
];

function scopeHref(target: 'me' | 'group'): string {
  const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  if (target === 'group') p.set('scope', 'group'); else p.delete('scope');
  const path = typeof window !== 'undefined' ? window.location.pathname : '/overview';
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

export function AppShell({ active, scope = 'me', children }: { active: string; scope?: 'me' | 'group'; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(true);
  const groupHidden = new Set(['/projects', '/sessions']);
  const items = scope === 'group' ? NAV.filter((n) => !groupHidden.has(n.href)) : NAV;
  return (
    <>
      <div id="top-nav">
        <TopNavigation
          identity={{ href: '/overview', title: 'ccusage-cloud' }}
          utilities={[
            { type: 'button', text: 'Me', href: scopeHref('me') },
            { type: 'button', text: 'Group', href: scopeHref('group') },
          ]}
        />
      </div>
      <AppLayout
        headerSelector="#top-nav"
        toolsHide
        navigationOpen={navOpen}
        onNavigationChange={({ detail }) => setNavOpen(detail.open)}
        navigation={<SideNavigation activeHref={active} header={{ href: '/overview', text: 'ccusage-cloud' }} items={items} />}
        content={children}
      />
    </>
  );
}
```
Note: a Cloudscape `TopNavigation` button-utility with `href` renders as an `<a>` (role `link`), satisfying the toggle test and integrating with `<ClientRouter />`. If the RED phase shows the utility renders differently, adjust the query to the actual element while keeping the assertion.

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test appshell` → PASS.
- [ ] **Step 5: Commit**
```bash
git add dashboard/src/components/AppShell.tsx dashboard/src/components/__tests__/appshell.test.tsx
git commit -m "feat(dashboard): Cloudscape AppShell with scope-gated nav"
```

---

### Task 3: FilterBar (Cloudscape)

**Files:**
- Modify (full rewrite): `dashboard/src/components/FilterBar.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/filterbar.test.tsx`

**Interfaces:**
- Produces: `FilterBar({ filters, sources, devices, onChange }: { filters: Filters; sources: string[]; devices: { id: string; label: string }[]; onChange: (f: Filters) => void })`.

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/filterbar.test.tsx` with:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../FilterBar';

describe('FilterBar', () => {
  it('emits a source change', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={{}} sources={['claude-code', 'cursor']} devices={[]} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('Source'));
    await userEvent.click(await screen.findByText('cursor'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: 'cursor' }));
  });
  it('clears filters', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={{ source: 'cursor' }} sources={['cursor']} devices={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test filterbar` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/FilterBar.tsx` with:
```tsx
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import type { Filters } from '@/lib/types';

export function FilterBar({
  filters, sources, devices, onChange,
}: { filters: Filters; sources: string[]; devices: { id: string; label: string }[]; onChange: (f: Filters) => void }) {
  const sourceOptions: SelectProps.Option[] = [{ label: 'All sources', value: '' }, ...sources.map((s) => ({ label: s, value: s }))];
  const deviceOptions: SelectProps.Option[] = [{ label: 'All devices', value: '' }, ...devices.map((d) => ({ label: d.label, value: d.id }))];
  const selSource = sourceOptions.find((o) => o.value === (filters.source ?? '')) ?? sourceOptions[0];
  const selDevice = deviceOptions.find((o) => o.value === (filters.device ?? '')) ?? deviceOptions[0];
  const set = <K extends keyof Filters>(key: K, value: string) => onChange({ ...filters, [key]: value || undefined });
  return (
    <SpaceBetween size="s" direction="horizontal">
      <FormField label="Source">
        <Select selectedOption={selSource} ariaLabel="Source" options={sourceOptions}
          onChange={({ detail }) => set('source', String(detail.selectedOption.value ?? ''))} />
      </FormField>
      <FormField label="Device">
        <Select selectedOption={selDevice} ariaLabel="Device" options={deviceOptions}
          onChange={({ detail }) => set('device', String(detail.selectedOption.value ?? ''))} />
      </FormField>
      <FormField label=" ">
        <Button onClick={() => onChange({})}>Clear</Button>
      </FormField>
    </SpaceBetween>
  );
}
```
Note: the spec mentions `DateRangePicker` for from/to. It is deferred from this task to keep the filter bar lean and testable; from/to remain settable via URL. If date-range filtering is wanted in the UI, add a `DateRangePicker` in a follow-up — do not block this task on its i18n boilerplate. (Flag for the controller: this is a deliberate deviation from the spec's filter description.)

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test filterbar` → PASS (adjust the Select option-click queries to Cloudscape's dropdown DOM if needed).
- [ ] **Step 5: Commit**
```bash
git add dashboard/src/components/FilterBar.tsx dashboard/src/components/__tests__/filterbar.test.tsx
git commit -m "feat(dashboard): Cloudscape FilterBar"
```

---

### Task 4: Overview page

**Files:**
- Modify (full rewrite): `dashboard/src/components/Overview.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/overview.test.tsx`
- Modify: `dashboard/src/pages/overview.astro`

**Interfaces:**
- Consumes: `AppShell` (Task 2), `FilterBar` (Task 3), `fmtInt`/`fmtUsd` (Task 1), `getMe`/`getSummary` from `@/lib/api`, filter helpers from `@/lib/filters`.

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/overview.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../Overview';

afterEach(() => vi.restoreAllMocks());

function routeFetch(map: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(map).find((k) => url.startsWith(k));
    return Promise.resolve(new Response(JSON.stringify(key ? map[key] : {}), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
}

describe('Overview', () => {
  it('renders headline totals from the summary', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/me': { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] },
      '/api/summary': {
        totals: { sessions: 3, totalTokens: 1465, inputTokens: 310, outputTokens: 155, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 3.5 },
        byDay: [{ day: '2026-06-20', totalTokens: 150, totalCost: 1 }], bySource: [], byModel: [], byProject: [], byDevice: [],
      },
    }));
    render(<Overview />);
    await waitFor(() => expect(screen.getByText('1,465')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/\$3\.50/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test overview` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/Overview.tsx` with:
```tsx
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import LineChart from '@cloudscape-design/components/line-chart';
import { getMe, getSummary } from '@/lib/api';
import type { Summary, Me } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { fmtInt, fmtUsd } from '@/lib/format';

function Kpi({ label, value }: { label: string; value: string }) {
  return (<div><Box variant="awsui-key-label">{label}</Box><Box fontSize="display-l" fontWeight="bold">{value}</Box></div>);
}

export function Overview() {
  const [filters, setFilters] = useState<Filters>({});
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { setLoading(true); getSummary(filters).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false)); }, [filters]);
  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
  const byDay = summary?.byDay ?? [];
  const totals = summary?.totals;

  return (
    <AppShell active="/overview" scope={filters.scope ?? 'me'}>
      <ContentLayout header={<Header variant="h1">Overview</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Filters</Header>}>
            <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          </Container>
          <Container>
            <ColumnLayout columns={3} variant="text-grid">
              <Kpi label="Sessions" value={fmtInt(totals?.sessions ?? 0)} />
              <Kpi label="Total tokens" value={fmtInt(totals?.totalTokens ?? 0)} />
              <Kpi label="Total cost" value={fmtUsd(totals?.totalCost ?? 0)} />
            </ColumnLayout>
          </Container>
          <Container header={<Header variant="h2">Tokens over time</Header>}>
            <LineChart series={[{ title: 'Total tokens', type: 'line', data: byDay.map((d) => ({ x: d.day, y: d.totalTokens })) }]}
              xScaleType="categorical" height={300} xTitle="Day" yTitle="Tokens" ariaLabel="Tokens over time"
              statusType={loading ? 'loading' : 'finished'} hideFilter empty={<Box textAlign="center" color="inherit">No data</Box>} />
          </Container>
          <Container header={<Header variant="h2">Cost over time</Header>}>
            <LineChart series={[{ title: 'Total cost (USD)', type: 'line', data: byDay.map((d) => ({ x: d.day, y: d.totalCost })) }]}
              xScaleType="categorical" height={300} xTitle="Day" yTitle="USD" ariaLabel="Cost over time"
              statusType={loading ? 'loading' : 'finished'} hideFilter empty={<Box textAlign="center" color="inherit">No data</Box>} />
          </Container>
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test overview` → PASS.

- [ ] **Step 5: Point the page at the Cloudscape layout**

Replace `dashboard/src/pages/overview.astro` with:
```astro
---
import Dashboard from '../layouts/Dashboard.astro';
import { Overview } from '../components/Overview';
---
<Dashboard title="Overview — ccusage-cloud">
  <Overview client:only="react" />
</Dashboard>
```

- [ ] **Step 6: Verify build** — `pnpm --filter dashboard build` → succeeds, emits the overview page.
- [ ] **Step 7: Commit**
```bash
git add dashboard/src/components/Overview.tsx dashboard/src/components/__tests__/overview.test.tsx dashboard/src/pages/overview.astro
git commit -m "feat(dashboard): Cloudscape Overview page"
```

---

### Task 5: Sources & Models page

**Files:**
- Modify (full rewrite): `dashboard/src/components/BySourceModel.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/bysourcemodel.test.tsx`
- Modify: `dashboard/src/pages/sources.astro`

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/bysourcemodel.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BySourceModel } from '../BySourceModel';

afterEach(() => vi.restoreAllMocks());

describe('BySourceModel', () => {
  it('renders source and model rows from the summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
        byDay: [], bySource: [{ source: 'claude-code', totalTokens: 100, totalCost: 1.2, sessions: 2 }],
        byModel: [{ model: 'claude-opus-4-8', totalTokens: 80, totalCost: 1.0 }], byProject: [], byDevice: [],
      }), { status: 200 }));
    }));
    render(<BySourceModel />);
    await waitFor(() => expect(screen.getByText('claude-code')).toBeInTheDocument());
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test bysourcemodel` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/BySourceModel.tsx` with:
```tsx
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import BarChart from '@cloudscape-design/components/bar-chart';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import { getMe, getSummary } from '@/lib/api';
import type { Summary, Me, BySource, ByModel } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { fmtInt, fmtUsd } from '@/lib/format';

export function BySourceModel() {
  const [filters, setFilters] = useState<Filters>({});
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { setLoading(true); getSummary(filters).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false)); }, [filters]);
  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
  const bySource = summary?.bySource ?? [];
  const byModel = summary?.byModel ?? [];
  const empty = <Box textAlign="center" color="inherit">No data</Box>;

  return (
    <AppShell active="/sources" scope={filters.scope ?? 'me'}>
      <ContentLayout header={<Header variant="h1">Sources &amp; Models</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Filters</Header>}>
            <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          </Container>
          <Container header={<Header variant="h2">By source</Header>}>
            <SpaceBetween size="m">
              <BarChart series={[{ title: 'Cost (USD)', type: 'bar', data: bySource.map((s) => ({ x: s.source, y: s.totalCost })) }]}
                xScaleType="categorical" height={260} xTitle="Source" yTitle="USD" ariaLabel="Cost by source"
                statusType={loading ? 'loading' : 'finished'} hideFilter hideLegend empty={empty} />
              <Table variant="embedded" items={bySource} trackBy="source" loading={loading} loadingText="Loading"
                empty={empty} columnDefinitions={[
                  { id: 'source', header: 'Source', cell: (s: BySource) => s.source },
                  { id: 'tokens', header: 'Tokens', cell: (s: BySource) => fmtInt(s.totalTokens) },
                  { id: 'cost', header: 'Cost', cell: (s: BySource) => fmtUsd(s.totalCost) },
                  { id: 'sessions', header: 'Sessions', cell: (s: BySource) => fmtInt(s.sessions) },
                ]} />
            </SpaceBetween>
          </Container>
          <Container header={<Header variant="h2">By model</Header>}>
            <SpaceBetween size="m">
              <BarChart series={[{ title: 'Cost (USD)', type: 'bar', data: byModel.map((m) => ({ x: m.model, y: m.totalCost })) }]}
                xScaleType="categorical" height={260} xTitle="Model" yTitle="USD" ariaLabel="Cost by model"
                statusType={loading ? 'loading' : 'finished'} hideFilter hideLegend empty={empty} />
              <Table variant="embedded" items={byModel} trackBy="model" loading={loading} loadingText="Loading"
                empty={empty} columnDefinitions={[
                  { id: 'model', header: 'Model', cell: (m: ByModel) => m.model },
                  { id: 'tokens', header: 'Tokens', cell: (m: ByModel) => fmtInt(m.totalTokens) },
                  { id: 'cost', header: 'Cost', cell: (m: ByModel) => fmtUsd(m.totalCost) },
                ]} />
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test bysourcemodel` → PASS.
- [ ] **Step 5: Update the page**

Replace `dashboard/src/pages/sources.astro` with:
```astro
---
import Dashboard from '../layouts/Dashboard.astro';
import { BySourceModel } from '../components/BySourceModel';
---
<Dashboard title="Sources & Models — ccusage-cloud">
  <BySourceModel client:only="react" />
</Dashboard>
```

- [ ] **Step 6: Verify build** — `pnpm --filter dashboard build` → succeeds.
- [ ] **Step 7: Commit**
```bash
git add dashboard/src/components/BySourceModel.tsx dashboard/src/components/__tests__/bysourcemodel.test.tsx dashboard/src/pages/sources.astro
git commit -m "feat(dashboard): Cloudscape Sources & Models page"
```

---

### Task 6: Projects page

Group-gated: in `scope=group`, render a notice and issue NO fetch.

**Files:**
- Modify (full rewrite): `dashboard/src/components/ByProject.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/byproject.test.tsx`
- Modify: `dashboard/src/pages/projects.astro`

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/byproject.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ByProject } from '../ByProject';

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

describe('ByProject', () => {
  it('renders project rows in me scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
        byDay: [], bySource: [], byModel: [], byProject: [{ projectPath: '/mnt/dev/x', totalTokens: 50, totalCost: 0.4, sessions: 1 }], byDevice: [],
      }), { status: 200 }));
    }));
    render(<ByProject />);
    await waitFor(() => expect(screen.getByText('/mnt/dev/x')).toBeInTheDocument());
  });

  it('shows a notice and fetches nothing in group scope', async () => {
    window.history.replaceState({}, '', '/projects?scope=group');
    const f = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', f);
    render(<ByProject />);
    await waitFor(() => expect(screen.getByText(/My view/i)).toBeInTheDocument());
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test byproject` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/ByProject.tsx` with:
```tsx
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import { useCollection } from '@cloudscape-design/collection-hooks';
import { getMe, getSummary } from '@/lib/api';
import type { Summary, Me, ByProject as ByProjectRow } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { fmtInt, fmtUsd } from '@/lib/format';

const columnDefinitions = [
  { id: 'projectPath', header: 'Project', cell: (p: ByProjectRow) => p.projectPath, sortingField: 'projectPath' },
  { id: 'totalTokens', header: 'Tokens', cell: (p: ByProjectRow) => fmtInt(p.totalTokens), sortingField: 'totalTokens' },
  { id: 'totalCost', header: 'Cost', cell: (p: ByProjectRow) => fmtUsd(p.totalCost), sortingField: 'totalCost' },
  { id: 'sessions', header: 'Sessions', cell: (p: ByProjectRow) => fmtInt(p.sessions), sortingField: 'sessions' },
];

export function ByProject() {
  const [filters, setFilters] = useState<Filters>(() => readFiltersFromUrl());
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const scope = filters.scope ?? 'me';

  useEffect(() => { if (scope === 'group') return; getMe().then(setMe).catch(() => setMe(null)); }, [scope]);
  useEffect(() => {
    if (scope === 'group') return; // overall-only: no project breakdown for the group
    setLoading(true);
    getSummary(filters).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false));
  }, [filters, scope]);
  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const rows = summary?.byProject ?? [];
  const { items, collectionProps } = useCollection(rows, {
    sorting: { defaultState: { sortingColumn: columnDefinitions[2], isDescending: true } },
  });

  if (scope === 'group') {
    return (
      <AppShell active="/projects" scope="group">
        <ContentLayout header={<Header variant="h1">Projects</Header>}>
          <Alert type="info">Switch to <b>My view</b> to see the project breakdown (not available in group scope).</Alert>
        </ContentLayout>
      </AppShell>
    );
  }

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];

  return (
    <AppShell active="/projects" scope={scope}>
      <ContentLayout header={<Header variant="h1">Projects</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Filters</Header>}>
            <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          </Container>
          <Table {...collectionProps} items={items} columnDefinitions={columnDefinitions} trackBy="projectPath"
            variant="full-page" stickyHeader loading={loading} loadingText="Loading"
            empty={<Box textAlign="center" color="inherit">No projects</Box>}
            header={<Header counter={`(${rows.length})`}>Top projects by cost</Header>} />
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test byproject` → PASS.
- [ ] **Step 5: Update the page**

Replace `dashboard/src/pages/projects.astro` with:
```astro
---
import Dashboard from '../layouts/Dashboard.astro';
import { ByProject } from '../components/ByProject';
---
<Dashboard title="Projects — ccusage-cloud">
  <ByProject client:only="react" />
</Dashboard>
```

- [ ] **Step 6: Verify build** — `pnpm --filter dashboard build` → succeeds.
- [ ] **Step 7: Commit**
```bash
git add dashboard/src/components/ByProject.tsx dashboard/src/components/__tests__/byproject.test.tsx dashboard/src/pages/projects.astro
git commit -m "feat(dashboard): Cloudscape Projects page"
```

---

### Task 7: Devices page

**Files:**
- Modify (full rewrite): `dashboard/src/components/ByDevice.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/bydevice.test.tsx`
- Modify: `dashboard/src/pages/devices.astro`

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/bydevice.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ByDevice } from '../ByDevice';

afterEach(() => vi.restoreAllMocks());

describe('ByDevice', () => {
  it('renders device rows from the summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
        byDay: [], bySource: [], byModel: [], byProject: [], byDevice: [{ deviceId: 'd1', label: 'work-laptop', totalTokens: 90, totalCost: 0.7, sessions: 3 }],
      }), { status: 200 }));
    }));
    render(<ByDevice />);
    await waitFor(() => expect(screen.getByText('work-laptop')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test bydevice` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/ByDevice.tsx` with:
```tsx
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import PieChart from '@cloudscape-design/components/pie-chart';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import { getMe, getSummary } from '@/lib/api';
import type { Summary, Me, ByDevice as ByDeviceRow } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { fmtInt, fmtUsd } from '@/lib/format';

export function ByDevice() {
  const [filters, setFilters] = useState<Filters>({});
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { setLoading(true); getSummary(filters).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false)); }, [filters]);
  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
  const byDevice = summary?.byDevice ?? [];
  const empty = <Box textAlign="center" color="inherit">No data</Box>;

  return (
    <AppShell active="/devices" scope={filters.scope ?? 'me'}>
      <ContentLayout header={<Header variant="h1">Devices</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Filters</Header>}>
            <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          </Container>
          <Container header={<Header variant="h2">Device contribution (by cost)</Header>}>
            <SpaceBetween size="m">
              <PieChart data={byDevice.map((d) => ({ title: d.label, value: d.totalCost }))} ariaLabel="Device contribution by cost"
                size="medium" statusType={loading ? 'loading' : 'finished'} hideFilter empty={empty}
                detailPopoverContent={(datum, sum) => [{ key: 'Cost', value: fmtUsd(datum.value) }, { key: 'Share', value: `${((datum.value / sum) * 100).toFixed(0)}%` }]} />
              <Table variant="embedded" items={byDevice} trackBy="deviceId" loading={loading} loadingText="Loading" empty={empty}
                columnDefinitions={[
                  { id: 'label', header: 'Device', cell: (d: ByDeviceRow) => d.label },
                  { id: 'tokens', header: 'Tokens', cell: (d: ByDeviceRow) => fmtInt(d.totalTokens) },
                  { id: 'cost', header: 'Cost', cell: (d: ByDeviceRow) => fmtUsd(d.totalCost) },
                  { id: 'sessions', header: 'Sessions', cell: (d: ByDeviceRow) => fmtInt(d.sessions) },
                ]} />
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test bydevice` → PASS.
- [ ] **Step 5: Update the page**

Replace `dashboard/src/pages/devices.astro` with:
```astro
---
import Dashboard from '../layouts/Dashboard.astro';
import { ByDevice } from '../components/ByDevice';
---
<Dashboard title="Devices — ccusage-cloud">
  <ByDevice client:only="react" />
</Dashboard>
```

- [ ] **Step 6: Verify build** — `pnpm --filter dashboard build` → succeeds.
- [ ] **Step 7: Commit**
```bash
git add dashboard/src/components/ByDevice.tsx dashboard/src/components/__tests__/bydevice.test.tsx dashboard/src/pages/devices.astro
git commit -m "feat(dashboard): Cloudscape Devices page"
```

---

### Task 8: Sessions page

Cursor-based "Load more"; group-gated.

**Files:**
- Modify (full rewrite): `dashboard/src/components/SessionsTable.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/sessionstable.test.tsx`
- Modify: `dashboard/src/pages/sessions.astro`

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/sessionstable.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsTable } from '../SessionsTable';

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

describe('SessionsTable', () => {
  it('renders session rows in me scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ sessions: [{ source: 'claude-code', sessionId: 'abc', deviceId: 'd1', totalTokens: 100, totalCost: 0.5, firstActivity: null, lastActivity: '2026-06-24T10:00:00Z', modelsUsed: ['claude-opus-4-8'], projectPath: '/p' }], nextCursor: null }), { status: 200 }));
    }));
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText('abc')).toBeInTheDocument());
  });

  it('shows a notice and fetches nothing in group scope', async () => {
    window.history.replaceState({}, '', '/sessions?scope=group');
    const f = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', f);
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText(/My view/i)).toBeInTheDocument());
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test sessionstable` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/SessionsTable.tsx` with:
```tsx
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import PropertyFilter from '@cloudscape-design/components/property-filter';
import { useCollection } from '@cloudscape-design/collection-hooks';
import { getMe, getSessions } from '@/lib/api';
import type { Me, SessionItem } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { fmtInt, fmtUsd, fmtTime } from '@/lib/format';

const columnDefinitions = [
  { id: 'source', header: 'Source', cell: (s: SessionItem) => s.source, sortingField: 'source' },
  { id: 'sessionId', header: 'Session', cell: (s: SessionItem) => s.sessionId, sortingField: 'sessionId' },
  { id: 'lastActivity', header: 'Last activity', cell: (s: SessionItem) => fmtTime(s.lastActivity), sortingField: 'lastActivity' },
  { id: 'totalTokens', header: 'Tokens', cell: (s: SessionItem) => fmtInt(s.totalTokens), sortingField: 'totalTokens' },
  { id: 'totalCost', header: 'Cost', cell: (s: SessionItem) => fmtUsd(s.totalCost), sortingField: 'totalCost' },
  { id: 'projectPath', header: 'Project', cell: (s: SessionItem) => s.projectPath ?? '(unknown)', sortingField: 'projectPath' },
];

const filteringProperties = [
  { key: 'source', propertyLabel: 'Source', groupValuesLabel: 'Sources', operators: ['=', '!=', ':', '!:'] },
  { key: 'projectPath', propertyLabel: 'Project', groupValuesLabel: 'Projects', operators: ['=', '!=', ':', '!:'] },
];

export function SessionsTable() {
  const [filters, setFilters] = useState<Filters>(() => readFiltersFromUrl());
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<SessionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scope = filters.scope ?? 'me';

  useEffect(() => { if (scope === 'group') return; getMe().then(setMe).catch(() => setMe(null)); }, [scope]);
  const loadFirst = useCallback((f: Filters) => {
    setLoading(true);
    getSessions(f).then((page) => { setRows(page.sessions); setCursor(page.nextCursor); })
      .catch(() => { setRows([]); setCursor(null); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (scope === 'group') return; loadFirst(filters); }, [filters, loadFirst, scope]);
  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const { items, collectionProps, propertyFilterProps, filteredItemsCount } = useCollection(rows, {
    propertyFiltering: { filteringProperties, empty: <Box textAlign="center" color="inherit">No sessions</Box>, noMatch: <Box textAlign="center" color="inherit">No matches</Box> },
    sorting: { defaultState: { sortingColumn: columnDefinitions[2], isDescending: true } },
  });

  if (scope === 'group') {
    return (
      <AppShell active="/sessions" scope="group">
        <ContentLayout header={<Header variant="h1">Sessions</Header>}>
          <Alert type="info">Session list is only available in <b>My view</b>. Switch scope to "Me".</Alert>
        </ContentLayout>
      </AppShell>
    );
  }

  function loadMore() {
    if (!cursor) return;
    setLoading(true);
    getSessions(filters, cursor).then((page) => { setRows((prev) => [...prev, ...page.sessions]); setCursor(page.nextCursor); })
      .catch(() => { /* keep current */ }).finally(() => setLoading(false));
  }

  const sources = me ? [] : [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];

  return (
    <AppShell active="/sessions" scope={scope}>
      <ContentLayout header={<Header variant="h1">Sessions</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Filters</Header>}>
            <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
          </Container>
          <Table {...collectionProps} items={items} columnDefinitions={columnDefinitions}
            trackBy={(s) => `${s.source}:${s.sessionId}`} variant="full-page" stickyHeader loading={loading} loadingText="Loading"
            header={<Header counter={`(${rows.length})`}>Sessions</Header>}
            filter={<PropertyFilter {...propertyFilterProps} filteringPlaceholder="Filter sessions" countText={`${filteredItemsCount} matches`} />}
            footer={cursor ? <Button onClick={loadMore} disabled={loading}>Load more</Button> : undefined} />
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test sessionstable` → PASS.
- [ ] **Step 5: Update the page**

Replace `dashboard/src/pages/sessions.astro` with:
```astro
---
import Dashboard from '../layouts/Dashboard.astro';
import { SessionsTable } from '../components/SessionsTable';
---
<Dashboard title="Sessions — ccusage-cloud">
  <SessionsTable client:only="react" />
</Dashboard>
```

- [ ] **Step 6: Verify build** — `pnpm --filter dashboard build` → succeeds.
- [ ] **Step 7: Commit**
```bash
git add dashboard/src/components/SessionsTable.tsx dashboard/src/components/__tests__/sessionstable.test.tsx dashboard/src/pages/sessions.astro
git commit -m "feat(dashboard): Cloudscape Sessions page"
```

---

### Task 9: Settings page

**Files:**
- Modify (full rewrite): `dashboard/src/components/SettingsDevices.tsx`
- Test (rewrite): `dashboard/src/components/__tests__/settingsdevices.test.tsx`
- Modify: `dashboard/src/pages/settings.astro`

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/settingsdevices.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsDevices } from '../SettingsDevices';

afterEach(() => vi.restoreAllMocks());
const me = { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] };

describe('SettingsDevices', () => {
  it('lists devices and toggles group sharing', async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/me') && init?.method === 'PATCH') return Promise.resolve(new Response(JSON.stringify({ publicToGroup: true }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<SettingsDevices />);
    await waitFor(() => expect(screen.getByText('laptop')).toBeInTheDocument());
    await userEvent.click(screen.getByText(/share my usage/i));
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' })));
  });

  it('adds a device and shows the token once', async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/devices' && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ id: 'd2', token: 'cccloud_secret' }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<SettingsDevices />);
    await waitFor(() => screen.getByText('laptop'));
    await userEvent.type(screen.getByLabelText('new device label'), 'phone');
    await userEvent.click(screen.getByRole('button', { name: /add device/i }));
    await waitFor(() => expect(screen.getByText('cccloud_secret')).toBeInTheDocument());
  });
});
```
Note: the group-sharing toggle is asserted by clicking its visible label text (`share my usage`), which is robust to whether Cloudscape `Toggle` exposes role `switch` or `checkbox`. If `userEvent.click` on the label doesn't toggle, query the control via `screen.getByRole('checkbox')` and adjust — keep the PATCH assertion.

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test settingsdevices` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/SettingsDevices.tsx` with:
```tsx
import { useEffect, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import Table from '@cloudscape-design/components/table';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import { getMe, patchMe, createDevice, deleteDevice, logout } from '@/lib/api';
import type { Me, DeviceInfo } from '@/lib/types';
import { AppShell } from '@/components/AppShell';

export function SettingsDevices() {
  const [me, setMe] = useState<Me | null>(null);
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  function refresh() { getMe().then(setMe).catch(() => setMe(null)); }
  useEffect(() => { refresh(); }, []);

  async function toggle(next: boolean) { await patchMe(next); refresh(); }
  async function add() {
    if (!label.trim()) return;
    const { token } = await createDevice(label.trim());
    setNewToken(token); setLabel(''); refresh();
  }
  async function revoke(id: string) { await deleteDevice(id); refresh(); }

  const devices = me?.devices ?? [];

  return (
    <AppShell active="/settings">
      <ContentLayout header={<Header variant="h1">Settings</Header>}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Group sharing</Header>}>
            <Toggle checked={me?.publicToGroup ?? false} onChange={({ detail }) => toggle(detail.checked)}>
              Share my usage with the group
            </Toggle>
          </Container>
          <Container header={<Header variant="h2">Devices</Header>}>
            <SpaceBetween size="m">
              <Table variant="embedded" items={devices} trackBy="id" empty={<Box textAlign="center" color="inherit">No devices</Box>}
                columnDefinitions={[
                  { id: 'label', header: 'Device', cell: (d: DeviceInfo) => (d.revokedAt ? `${d.label} (revoked)` : d.label) },
                  { id: 'actions', header: '', cell: (d: DeviceInfo) => (d.revokedAt ? '—' : <Button onClick={() => revoke(d.id)}>Revoke</Button>) },
                ]} />
              <FormField label="New device">
                <SpaceBetween size="xs" direction="horizontal">
                  <Input value={label} ariaLabel="new device label" placeholder="laptop" onChange={({ detail }) => setLabel(detail.value)} />
                  <Button variant="primary" onClick={add}>Add device</Button>
                </SpaceBetween>
              </FormField>
              {newToken && (
                <Alert type="warning" header="Copy this token now — it is shown only once">
                  <Box variant="code">{newToken}</Box>
                </Alert>
              )}
            </SpaceBetween>
          </Container>
          <Button variant="link" onClick={() => logout().then(() => { window.location.href = '/'; })}>Log out</Button>
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}
```
Note: `Input` here uses `ariaLabel="new device label"` so the test's `getByLabelText('new device label')` resolves. Confirm Cloudscape `Input` forwards `ariaLabel` to an accessible name; if not, wrap it so the label associates, keeping the test's label query.

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test settingsdevices` → PASS.
- [ ] **Step 5: Update the page**

Replace `dashboard/src/pages/settings.astro` with:
```astro
---
import Dashboard from '../layouts/Dashboard.astro';
import { SettingsDevices } from '../components/SettingsDevices';
---
<Dashboard title="Settings — ccusage-cloud">
  <SettingsDevices client:only="react" />
</Dashboard>
```

- [ ] **Step 6: Verify build** — `pnpm --filter dashboard build` → succeeds.
- [ ] **Step 7: Commit**
```bash
git add dashboard/src/components/SettingsDevices.tsx dashboard/src/components/__tests__/settingsdevices.test.tsx dashboard/src/pages/settings.astro
git commit -m "feat(dashboard): Cloudscape Settings page"
```

---

### Task 10: Login pages

**Files:**
- Modify (full rewrite): `dashboard/src/components/LoginGate.tsx`
- Test (create): `dashboard/src/components/__tests__/logingate.test.tsx` (rewrite the existing one)
- Modify: `dashboard/src/pages/index.astro`
- Modify: `dashboard/src/pages/login.astro`
- Modify: `dashboard/e2e/login-overview.test.tsx` (update token-count assertions to formatted values + Cloudscape selectors, preserving the behavior)

- [ ] **Step 1: Rewrite the failing test**

Replace `dashboard/src/components/__tests__/logingate.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginGate } from '../LoginGate';

afterEach(() => vi.restoreAllMocks());

describe('LoginGate', () => {
  it('shows the email form when anonymous and sends a magic link', async () => {
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response('{}', { status: 401 }));
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<LoginGate />);
    const email = await screen.findByLabelText('email');
    await userEvent.type(email, 'me@x.com');
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeInTheDocument());
    expect(f).toHaveBeenCalledWith('/auth/request', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Run it (RED)** — `pnpm --filter dashboard test logingate` → FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/LoginGate.tsx` with:
```tsx
import { useEffect, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import { getMe, requestLogin } from '@/lib/api';

type State = 'checking' | 'anon' | 'sent';

export function LoginGate() {
  const [state, setState] = useState<State>('checking');
  const [email, setEmail] = useState('');

  useEffect(() => {
    getMe().then(() => { if (typeof window !== 'undefined') window.location.href = '/overview'; }).catch(() => setState('anon'));
  }, []);

  async function submit() {
    try { await requestLogin(email); } catch { /* never reveal */ }
    setState('sent');
  }

  const Centered = ({ children }: { children: React.ReactNode }) => (
    <Box margin={{ top: 'xxxl' }}><div style={{ maxWidth: 420, margin: '0 auto' }}>{children}</div></Box>
  );

  if (state === 'checking') return <Centered><Box color="text-status-inactive">Loading…</Box></Centered>;
  if (state === 'sent') return (
    <Centered><Container header={<Header variant="h2">Check your inbox</Header>}>
      <Box>If your email is invited, a magic link is on its way.</Box>
    </Container></Centered>
  );
  return (
    <Centered>
      <Container header={<Header variant="h2">Sign in to ccusage-cloud</Header>}>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Form actions={<Button variant="primary" onClick={submit}>Send magic link</Button>}>
            <FormField label="Email">
              <Input value={email} ariaLabel="email" type="email" placeholder="you@example.com"
                onChange={({ detail }) => setEmail(detail.value)} />
            </FormField>
          </Form>
        </form>
      </Container>
    </Centered>
  );
}
```
Note: keep the native `<form onSubmit>` wrapper so Enter submits and the magic-link POST fires; the visible submit `Button` also calls `submit`. Confirm `Input ariaLabel="email"` yields an accessible name matching `getByLabelText('email')`.

- [ ] **Step 4: Run it (GREEN)** — `pnpm --filter dashboard test logingate` → PASS.

- [ ] **Step 5: Update the login pages**

Replace `dashboard/src/pages/index.astro` with:
```astro
---
import Dashboard from '../layouts/Dashboard.astro';
import { LoginGate } from '../components/LoginGate';
---
<Dashboard title="ccusage-cloud">
  <LoginGate client:only="react" />
</Dashboard>
```
Apply the same change to `dashboard/src/pages/login.astro` (swap its layout import to `Dashboard.astro`, mount `LoginGate` with `client:only="react"`; keep its existing title if it has one).

- [ ] **Step 6: Update the e2e test's formatted assertions**

In `dashboard/e2e/login-overview.test.tsx`, change the Overview token-count assertion from the raw value to the comma-formatted value: `screen.getByText('1000')` → `screen.getByText('1,000')`. Keep `getByText('7')` and `getByText(/\$9\.99/)`. The login-gate assertion (`queryByLabelText('email')` absent for an authenticated user) stays.

- [ ] **Step 7: Run e2e + build** — `pnpm --filter dashboard test:e2e` → PASS; `pnpm --filter dashboard build` → succeeds.
- [ ] **Step 8: Commit**
```bash
git add dashboard/src/components/LoginGate.tsx dashboard/src/components/__tests__/logingate.test.tsx dashboard/src/pages/index.astro dashboard/src/pages/login.astro dashboard/e2e/login-overview.test.tsx
git commit -m "feat(dashboard): Cloudscape login pages"
```

---

### Task 11: Remove the old stack + final verification

**Files:**
- Delete: `dashboard/src/components/ui/` (all), `dashboard/src/styles/global.css`, `dashboard/tailwind.config.ts`, `dashboard/components.json`, `dashboard/src/lib/utils.ts`, `dashboard/src/layouts/Base.astro`
- Modify: `dashboard/package.json` (drop old UI deps), `dashboard/astro.config.mjs` (remove Tailwind plugin)

**Interfaces:** none produced; this task only removes code now unreferenced.

- [ ] **Step 1: Confirm nothing still imports the old stack**

Run: `grep -rEl "components/ui/|lib/utils|global.css|layouts/Base|recharts|lucide-react|@radix-ui|class-variance-authority|tailwind-merge|clsx" dashboard/src dashboard/*.mjs dashboard/*.ts`
Expected: no matches under `dashboard/src` (only `node_modules`/lockfile may match elsewhere). If any source file matches, that file was missed by an earlier task — fix it before deleting.

- [ ] **Step 2: Delete the old files**
```bash
git rm -r dashboard/src/components/ui
git rm dashboard/src/styles/global.css dashboard/tailwind.config.ts dashboard/components.json dashboard/src/lib/utils.ts dashboard/src/layouts/Base.astro
```

- [ ] **Step 3: Drop old deps from `dashboard/package.json`**

Remove these dependency entries: `recharts`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@radix-ui/react-switch`, `@radix-ui/react-tabs`, `@radix-ui/react-slot`; and these devDependencies: `@tailwindcss/vite`, `tailwindcss`. Then run `pnpm install` to update the lockfile.

- [ ] **Step 4: Remove the Tailwind Vite plugin**

Replace `dashboard/astro.config.mjs` with:
```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  output: 'static',
  integrations: [react()],
});
```

- [ ] **Step 5: Full verification**

Run, expecting all green:
```bash
pnpm --filter dashboard exec astro check   # pre-existing vitest.config.ts vite-version error may remain; no NEW errors
pnpm --filter dashboard build              # builds all pages
pnpm --filter dashboard test               # all unit/component tests pass
pnpm --filter dashboard test:e2e           # e2e passes
```
Then confirm the grep from Step 1 is clean and `git status` shows only intended changes.

- [ ] **Step 6: Commit**
```bash
git add -A dashboard
git commit -m "chore(dashboard): remove shadcn/Tailwind/recharts stack"
```

---

## Done when

- All real routes (`/`, `/login`, `/overview`, `/sources`, `/projects`, `/devices`, `/sessions`, `/settings`) render in Cloudscape against live data; navigation is smoothed by `<ClientRouter />`.
- No shadcn/Tailwind/recharts source or deps remain (Step 1 grep clean); `lib/utils.ts`, `Base.astro`, `global.css` gone.
- `pnpm --filter dashboard build`, `test`, and `test:e2e` all pass; `worker/` and `cli/` untouched.
- Branch `feat/cloudscape-migration` merges to `master` only when the whole thing is green.

## Deferred follow-up (not this plan)

Vite + React SPA migration with client-side routing and a persistent `AppLayout` shell — removes the per-navigation shell re-hydration that remains with Astro islands + `<ClientRouter />`.

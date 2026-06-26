import { useEffect, useState, useCallback, useMemo } from 'react';
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
  const [filters, setFilters] = useState<Filters>(() => readFiltersFromUrl());
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { setLoading(true); getSummary(filters).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false)); }, [filters]);
  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
  const byDay = summary?.byDay ?? [];
  const totals = summary?.totals;

  // Total line plus one line per source (over the same days), defaulting missing days to 0.
  // Memoized so each LineChart's `series` identity is stable, keeping its series filter working.
  const series = useMemo(() => {
    const rows = summary?.byDay ?? [];
    const days = rows.map((d) => d.day);
    const srcs = summary?.bySource.map((s) => s.source) ?? [];
    const bds = summary?.byDaySource ?? [];
    const lines = (metric: 'totalTokens' | 'totalCost', totalTitle: string) => {
      const byKey = new Map(bds.map((r) => [`${r.source} ${r.day}`, r[metric]]));
      const perSource = srcs.map((src) => ({
        title: src,
        type: 'line' as const,
        data: days.map((day) => ({ x: day, y: byKey.get(`${src} ${day}`) ?? 0 })),
      }));
      return [
        { title: totalTitle, type: 'line' as const, data: rows.map((d) => ({ x: d.day, y: d[metric] })) },
        ...perSource,
      ];
    };
    return { tokens: lines('totalTokens', 'Total tokens'), cost: lines('totalCost', 'Total cost (USD)') };
  }, [summary]);

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
            <LineChart series={series.tokens}
              xScaleType="categorical" height={300} xTitle="Day" yTitle="Tokens" ariaLabel="Tokens over time"
              statusType={loading ? 'loading' : 'finished'} hideFilter empty={<Box textAlign="center" color="inherit">No data</Box>} />
          </Container>
          <Container header={<Header variant="h2">Cost over time</Header>}>
            <LineChart series={series.cost}
              xScaleType="categorical" height={300} xTitle="Day" yTitle="USD" ariaLabel="Cost over time"
              statusType={loading ? 'loading' : 'finished'} hideFilter empty={<Box textAlign="center" color="inherit">No data</Box>} />
          </Container>
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}

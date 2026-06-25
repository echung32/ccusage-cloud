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

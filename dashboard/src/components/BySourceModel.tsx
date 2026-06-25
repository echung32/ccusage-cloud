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

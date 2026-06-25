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

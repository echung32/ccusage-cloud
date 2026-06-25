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

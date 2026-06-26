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
            trackBy={(s) => `${s.source}:${s.sessionId}:${s.deviceId}:${s.projectPath ?? ''}`} variant="full-page" stickyHeader loading={loading} loadingText="Loading"
            header={<Header counter={`(${rows.length})`}>Sessions</Header>}
            filter={<PropertyFilter {...propertyFilterProps} i18nStrings={propertyFilterI18n} filteringPlaceholder="Filter sessions" countText={`${filteredItemsCount} matches`} />}
            footer={cursor ? <Button onClick={loadMore} disabled={loading}>Load more</Button> : undefined} />
        </SpaceBetween>
      </ContentLayout>
    </AppShell>
  );
}

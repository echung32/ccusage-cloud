import { useEffect, useState, useCallback } from 'react';
import { getMe, getSessions } from '@/lib/api';
import type { Me, SessionItem } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

type SortKey = 'lastActivity' | 'totalTokens' | 'totalCost';

export function SessionsTable() {
  const [filters, setFilters] = useState<Filters>(() => readFiltersFromUrl());
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<SessionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('lastActivity');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if ((filters.scope ?? 'me') === 'group') return;
    getMe().then(setMe).catch(() => setMe(null));
  }, [filters.scope]);

  const scope = filters.scope ?? 'me';

  const loadFirst = useCallback((f: Filters) => {
    setLoading(true);
    getSessions(f)
      .then((page) => { setRows(page.sessions); setCursor(page.nextCursor); })
      .catch(() => { setRows([]); setCursor(null); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (scope === 'group') return; // overall-only: no session breakdown for the group
    loadFirst(filters);
  }, [filters, loadFirst, scope]);

  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  if (scope === 'group') {
    return (
      <AppShell active="/sessions" scope="group">
        <p className="p-4 text-sm text-slate-600">Session list is only available in <strong>My</strong> view. Switch scope to "Me".</p>
      </AppShell>
    );
  }

  function loadMore() {
    if (!cursor) return;
    setLoading(true);
    getSessions(filters, cursor)
      .then((page) => { setRows((prev) => [...prev, ...page.sessions]); setCursor(page.nextCursor); })
      .catch(() => { /* keep current */ })
      .finally(() => setLoading(false));
  }

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'lastActivity') return String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''));
    return (b[sort] as number) - (a[sort] as number);
  });

  const sources = me ? [] : [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];

  return (
    <AppShell active="/sessions" scope={scope}>
      <div className="space-y-6">
        <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
        <Card>
          <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH>Session</TH>
                  <TH><button onClick={() => setSort('lastActivity')}>Last activity</button></TH>
                  <TH><button onClick={() => setSort('totalTokens')}>Tokens</button></TH>
                  <TH><button onClick={() => setSort('totalCost')}>Cost</button></TH>
                  <TH>Project</TH>
                </TR>
              </THead>
              <TBody>
                {sorted.map((s) => (
                  <TR key={`${s.source}:${s.sessionId}`}>
                    <TD>{s.source}</TD>
                    <TD className="font-mono">{s.sessionId}</TD>
                    <TD>{s.lastActivity ?? '—'}</TD>
                    <TD>{s.totalTokens}</TD>
                    <TD>${s.totalCost.toFixed(2)}</TD>
                    <TD className="font-mono">{s.projectPath ?? '(unknown)'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {cursor && (
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>Load more</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { getMe, getSummary } from '@/lib/api';
import type { Summary, Me } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ByProject() {
  const [filters, setFilters] = useState<Filters>(() => readFiltersFromUrl());
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (filters.scope === 'group') return;
    getMe().then(setMe).catch(() => setMe(null));
  }, [filters.scope]);

  const scope = filters.scope ?? 'me';

  useEffect(() => {
    if (scope === 'group') return; // overall-only: no project breakdown for the group
    getSummary(filters).then(setSummary).catch(() => setSummary(null));
  }, [filters, scope]);

  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  if (scope === 'group') {
    return (
      <AppShell active="/projects" scope="group">
        <p className="p-4 text-sm text-slate-600">Switch to My view to see project breakdown (not available in group scope).</p>
      </AppShell>
    );
  }

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
  const rows = [...(summary?.byProject ?? [])].sort((a, b) => b.totalCost - a.totalCost);

  return (
    <AppShell active="/projects" scope={scope}>
      <div className="space-y-6">
        <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
        <Card>
          <CardHeader><CardTitle>Top projects by cost</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Project</th><th>Tokens</th><th>Cost</th><th>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.projectPath} className="border-t border-slate-100">
                    <td className="py-1 font-mono">{p.projectPath}</td>
                    <td>{p.totalTokens}</td>
                    <td>${p.totalCost.toFixed(2)}</td>
                    <td>{p.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

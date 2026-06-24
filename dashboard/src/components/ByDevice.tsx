import { useEffect, useState, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { getMe, getSummary } from '@/lib/api';
import type { Summary, Me } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLORS = ['#0f172a', '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ca8a04'];

export function ByDevice() {
  const [filters, setFilters] = useState<Filters>({});
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { getSummary(filters).then(setSummary).catch(() => setSummary(null)); }, [filters]);
  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];
  const data = summary?.byDevice ?? [];

  return (
    <AppShell active="/devices">
      <div className="space-y-6">
        <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
        <Card>
          <CardHeader><CardTitle>Device contribution (by cost)</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="totalCost" nameKey="label" outerRadius={120}>
                    {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 text-sm text-slate-600">
              {data.map((d) => (
                <li key={d.deviceId}>{d.label}: {d.totalTokens} tokens, ${d.totalCost.toFixed(2)}, {d.sessions} sessions</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

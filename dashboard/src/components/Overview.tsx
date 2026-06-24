import { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getMe, getSummary } from '@/lib/api';
import type { Summary, Me } from '@/lib/types';
import { readFiltersFromUrl, writeFiltersToUrl, type Filters } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
      <CardContent><p className="text-2xl font-bold">{value}</p></CardContent>
    </Card>
  );
}

export function Overview() {
  const [filters, setFilters] = useState<Filters>({});
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => { setFilters(readFiltersFromUrl()); getMe().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { getSummary(filters).then(setSummary).catch(() => setSummary(null)); }, [filters]);

  const onChange = useCallback((f: Filters) => { writeFiltersToUrl(f); setFilters(f); }, []);

  const sources = summary?.bySource.map((s) => s.source) ?? [];
  const devices = me?.devices.map((d) => ({ id: d.id, label: d.label })) ?? [];

  return (
    <AppShell active="/overview" scope={filters.scope ?? 'me'}>
      <div className="space-y-6">
        <FilterBar filters={filters} sources={sources} devices={devices} onChange={onChange} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Sessions" value={String(summary?.totals.sessions ?? 0)} />
          <Stat label="Total tokens" value={String(summary?.totals.totalTokens ?? 0)} />
          <Stat label="Total cost" value={`$${(summary?.totals.totalCost ?? 0).toFixed(2)}`} />
        </div>
        <Card>
          <CardHeader><CardTitle>Tokens &amp; cost over time</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary?.byDay ?? []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Line yAxisId="left" type="monotone" dataKey="totalTokens" stroke="#0f172a" dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="totalCost" stroke="#2563eb" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

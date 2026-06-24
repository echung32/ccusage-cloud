import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Filters } from '@/lib/types';

export function FilterBar({
  filters,
  sources,
  devices,
  onChange,
}: {
  filters: Filters;
  sources: string[];
  devices: { id: string; label: string }[];
  onChange: (f: Filters) => void;
}) {
  function set<K extends keyof Filters>(key: K, value: string) {
    onChange({ ...filters, [key]: value || undefined });
  }
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="filter-bar">
      <label className="text-xs text-slate-500">
        From
        <Input type="date" aria-label="from" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} />
      </label>
      <label className="text-xs text-slate-500">
        To
        <Input type="date" aria-label="to" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} />
      </label>
      <label className="text-xs text-slate-500">
        Source
        <select
          aria-label="source"
          className="flex h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
          value={filters.source ?? ''}
          onChange={(e) => set('source', e.target.value)}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-500">
        Device
        <select
          aria-label="device"
          className="flex h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
          value={filters.device ?? ''}
          onChange={(e) => set('device', e.target.value)}
        >
          <option value="">All devices</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </label>
      <Button variant="outline" size="sm" onClick={() => onChange({})}>Clear</Button>
    </div>
  );
}

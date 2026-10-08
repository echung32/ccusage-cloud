import type { Filters } from "@/lib/types";
import { rangeToFilters } from "@/lib/daterange";

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
  const set = (key: keyof Filters, value: string) =>
    onChange({ ...filters, [key]: value || undefined });
  const sourceOptions = [
    ...new Set([
      "claude-code",
      "codex",
      "cursor",
      ...sources,
      ...(filters.source ? [filters.source] : []),
    ]),
  ];
  return (
    <div className="filter-bar">
      <label>
        Source
        <select
          aria-label="Source"
          value={filters.source ?? ""}
          onChange={(e) => set("source", e.target.value)}
        >
          <option value="">All sources</option>
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Device
        <select
          aria-label="Device"
          value={filters.device ?? ""}
          onChange={(e) => set("device", e.target.value)}
        >
          <option value="">All devices</option>
          {filters.device && !devices.some((d) => d.id === filters.device) && (
            <option value={filters.device}>{filters.device}</option>
          )}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        From
        <input
          type="date"
          value={filters.from?.slice(0, 10) ?? ""}
          max={filters.to?.slice(0, 10)}
          onChange={(e) =>
            set("from", e.target.value ? `${e.target.value}T00:00:00.000Z` : "")
          }
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={filters.to?.slice(0, 10) ?? ""}
          min={filters.from?.slice(0, 10)}
          onChange={(e) =>
            set("to", e.target.value ? `${e.target.value}T23:59:59.999Z` : "")
          }
        />
      </label>
      <label>
        Quick range
        <select
          aria-label="Quick range"
          value=""
          onChange={(e) =>
            onChange({
              ...filters,
              ...rangeToFilters({
                type: "relative",
                amount: Number(e.target.value),
                unit: "day",
              }),
            })
          }
        >
          <option value="">Choose range</option>
          {[7, 14, 30, 90].map((n) => (
            <option key={n} value={n}>
              Last {n} days
            </option>
          ))}
        </select>
      </label>
      <button className="button button-quiet" onClick={() => onChange({})}>
        Clear
      </button>
    </div>
  );
}

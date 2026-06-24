export type { Filters } from './types';
import type { Filters } from './types';

export function readFiltersFromUrl(): Filters {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const f: Filters = {};
  for (const k of ['from', 'to', 'source', 'device'] as const) {
    const v = p.get(k);
    if (v) f[k] = v;
  }
  return f;
}

export function writeFiltersToUrl(f: Filters): void {
  if (typeof window === 'undefined') return;
  const p = new URLSearchParams(window.location.search);
  for (const k of ['from', 'to', 'source', 'device'] as const) {
    const v = f[k];
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

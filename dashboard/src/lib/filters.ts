export type { Filters } from "./types";
import type { Filters } from "./types";
const KEYS = ["from", "to", "source", "device"] as const;
export function readFiltersFromUrl(): Filters {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const filters: Filters = {};
  for (const key of KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}
export function writeFiltersToUrl(filters: Filters): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.delete("scope");
  for (const key of KEYS) {
    if (filters[key]) params.set(key, filters[key]);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

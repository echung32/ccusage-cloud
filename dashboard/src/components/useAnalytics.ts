import { useCallback, useEffect, useState } from "react";
import { getMe, getSummary } from "@/lib/api";
import { readFiltersFromUrl, writeFiltersToUrl } from "@/lib/filters";
import type { Filters, Me, Summary } from "@/lib/types";

export function useAnalytics() {
  const [filters, setFilters] = useState<Filters>(readFiltersFromUrl);
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    getMe()
      .then((data) => {
        if (current) setMe(data);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    getSummary(filters)
      .then((data) => {
        if (current) setSummary(data);
      })
      .catch(() => {
        if (current) {
          setSummary(null);
          setError("Unable to load your usage. Please try again.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filters, revision]);
  const onChange = useCallback((next: Filters) => {
    writeFiltersToUrl(next);
    setFilters(next);
  }, []);
  return {
    filters,
    onChange,
    me,
    summary,
    loading,
    error,
    retry: () => setRevision((n) => n + 1),
    sources: summary?.bySource?.map((s) => s.source) ?? [],
    devices:
      me?.devices
        ?.filter((d) => !d.revokedAt)
        .map((d) => ({ id: d.id, label: d.label })) ?? [],
  };
}

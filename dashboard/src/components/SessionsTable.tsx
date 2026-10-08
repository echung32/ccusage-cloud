import { useEffect, useRef, useState } from "react";
import { getMe, getSessions } from "@/lib/api";
import { readFiltersFromUrl, writeFiltersToUrl } from "@/lib/filters";
import type { Filters, Me, SessionItem } from "@/lib/types";
import { fmtInt, fmtUsd, fmtTime } from "@/lib/format";
import { AppShell } from "./AppShell";
import { FilterBar } from "./FilterBar";
import { PageHeading, Panel, DataTable, LoadingState, ErrorState } from "./ui";

export function SessionsTable() {
  const [filters, setFilters] = useState<Filters>(readFiltersFromUrl);
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<SessionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
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
    const request = ++generation.current;
    setLoading(true);
    setError("");
    setMoreError("");
    setMoreLoading(false);
    setCursor(null);
    getSessions(filters)
      .then((page) => {
        if (request === generation.current) {
          setRows(page.sessions);
          setCursor(page.nextCursor);
        }
      })
      .catch(() => {
        if (request === generation.current) {
          setRows([]);
          setError("Unable to load your sessions. Please try again.");
        }
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [filters, revision]);
  async function loadMore() {
    if (!cursor || moreLoading) return;
    const request = generation.current;
    setMoreLoading(true);
    setMoreError("");
    try {
      const page = await getSessions(filters, cursor);
      if (request === generation.current) {
        setRows((previous) => [...previous, ...page.sessions]);
        setCursor(page.nextCursor);
      }
    } catch {
      if (request === generation.current)
        setMoreError(
          "Unable to load more sessions. Your loaded rows are still here.",
        );
    } finally {
      if (request === generation.current) setMoreLoading(false);
    }
  }
  return (
    <AppShell active="/sessions">
      <PageHeading
        title="Your activity, in detail."
        description="Explore individual sessions, find projects, and follow your recent work."
      />
      <div className="stack">
        <Panel className="filter-panel">
          <FilterBar
            filters={filters}
            onChange={(next) => {
              generation.current++;
              writeFiltersToUrl(next);
              setFilters(next);
            }}
            sources={[...new Set(rows.map((r) => r.source))]}
            devices={
              me?.devices
                .filter((d) => !d.revokedAt)
                .map((d) => ({ id: d.id, label: d.label })) ?? []
            }
          />
        </Panel>
        {error ? (
          <ErrorState message={error} retry={() => setRevision((n) => n + 1)} />
        ) : loading ? (
          <LoadingState />
        ) : (
          <Panel
            title="Sessions"
            description="Search and sort loaded sessions. Load more to explore older activity."
          >
            <DataTable
              rows={rows}
              rowKey={(s) =>
                JSON.stringify([
                  s.source,
                  s.sessionId,
                  s.deviceId,
                  s.projectPath,
                ])
              }
              searchLabel="Find sessions"
              emptyTitle="No sessions"
              defaultSort={{ key: "lastActivity", descending: true }}
              columns={[
                {
                  key: "source",
                  label: "Source",
                  render: (s) => <span className="tag">{s.source}</span>,
                },
                {
                  key: "sessionId",
                  label: "Session",
                  render: (s) => <span className="mono">{s.sessionId}</span>,
                },
                {
                  key: "lastActivity",
                  label: "Last activity",
                  render: (s) => fmtTime(s.lastActivity),
                },
                {
                  key: "totalTokens",
                  label: "Tokens",
                  render: (s) => fmtInt(s.totalTokens),
                },
                {
                  key: "totalCost",
                  label: "Cost",
                  render: (s) => fmtUsd(s.totalCost),
                },
                {
                  key: "projectPath",
                  label: "Project",
                  render: (s) => (
                    <span className="mono">{s.projectPath ?? "(unknown)"}</span>
                  ),
                },
              ]}
            />
            {moreError && <ErrorState message={moreError} />}
            {cursor && (
              <button
                className="button"
                style={{ marginTop: 20 }}
                disabled={moreLoading}
                onClick={loadMore}
              >
                {moreLoading ? "Loading…" : "Load more"}
              </button>
            )}
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

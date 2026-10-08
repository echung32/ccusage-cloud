import { AppShell } from "./AppShell";
import { FilterBar } from "./FilterBar";
import { CostBars } from "./Charts";
import { PageHeading, Panel, DataTable, LoadingState, ErrorState } from "./ui";
import { useAnalytics } from "./useAnalytics";
import { fmtInt, fmtUsd } from "@/lib/format";
import type { BySource, ByModel } from "@/lib/types";

export function BySourceModel() {
  const data = useAnalytics();
  const bySource = data.summary?.bySource ?? [],
    byModel = data.summary?.byModel ?? [];
  return (
    <AppShell active="/sources">
      <PageHeading
        title="Sources & Models"
        description="See which tools and models power your work — and what they cost."
      />
      <div className="stack">
        <Panel className="filter-panel">
          <FilterBar {...data} />
        </Panel>
        {data.error ? (
          <ErrorState message={data.error} retry={data.retry} />
        ) : data.loading ? (
          <LoadingState />
        ) : (
          <div className="chart-grid">
            <Panel
              title="By source"
              description="Compare usage across your AI tools."
            >
              <CostBars
                title="Cost by source"
                rows={bySource.map((s) => ({
                  label: s.source,
                  value: s.totalCost,
                }))}
              />
              <DataTable
                rows={bySource}
                rowKey={(s) => s.source}
                columns={[
                  {
                    key: "source",
                    label: "Source",
                    render: (s: BySource) => (
                      <span className="tag">{s.source}</span>
                    ),
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
                    key: "sessions",
                    label: "Sessions",
                    render: (s) => fmtInt(s.sessions),
                  },
                ]}
              />
            </Panel>
            <Panel
              title="By model"
              description="Find the models behind your spending."
            >
              <CostBars
                title="Cost by model"
                rows={byModel.map((m) => ({
                  label: m.model,
                  value: m.totalCost,
                }))}
              />
              <DataTable
                rows={byModel}
                rowKey={(m) => m.model}
                columns={[
                  {
                    key: "model",
                    label: "Model",
                    render: (m: ByModel) => (
                      <span className="mono">{m.model}</span>
                    ),
                  },
                  {
                    key: "totalTokens",
                    label: "Tokens",
                    render: (m) => fmtInt(m.totalTokens),
                  },
                  {
                    key: "totalCost",
                    label: "Cost",
                    render: (m) => fmtUsd(m.totalCost),
                  },
                ]}
              />
            </Panel>
          </div>
        )}
      </div>
    </AppShell>
  );
}

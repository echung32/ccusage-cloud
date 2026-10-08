import { AppShell } from "./AppShell";
import { FilterBar } from "./FilterBar";
import { CostBars } from "./Charts";
import { PageHeading, Panel, DataTable, LoadingState, ErrorState } from "./ui";
import { useAnalytics } from "./useAnalytics";
import { fmtInt, fmtUsd } from "@/lib/format";

export function ByDevice() {
  const data = useAnalytics();
  const rows = data.summary?.byDevice ?? [];
  return (
    <AppShell active="/devices">
      <PageHeading
        title="Every device, one picture."
        description="Compare activity and spending across the machines you work on."
        action={
          <a className="button" href="/settings">
            Manage devices ↗
          </a>
        }
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
          <Panel
            title="Device contribution"
            description="Your devices’ share of estimated cost."
          >
            <CostBars
              title="Device contribution by cost"
              rows={rows.map((d) => ({ label: d.label, value: d.totalCost }))}
            />
            <DataTable
              rows={rows}
              rowKey={(d) => d.deviceId}
              columns={[
                { key: "label", label: "Device", render: (d) => d.label },
                {
                  key: "totalTokens",
                  label: "Tokens",
                  render: (d) => fmtInt(d.totalTokens),
                },
                {
                  key: "totalCost",
                  label: "Cost",
                  render: (d) => fmtUsd(d.totalCost),
                },
                {
                  key: "sessions",
                  label: "Sessions",
                  render: (d) => fmtInt(d.sessions),
                },
              ]}
            />
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

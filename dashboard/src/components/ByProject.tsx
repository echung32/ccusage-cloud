import { AppShell } from "./AppShell";
import { FilterBar } from "./FilterBar";
import { PageHeading, Panel, DataTable, LoadingState, ErrorState } from "./ui";
import { useAnalytics } from "./useAnalytics";
import { fmtInt, fmtUsd } from "@/lib/format";

export function ByProject() {
  const data = useAnalytics();
  return (
    <AppShell active="/projects">
      <PageHeading
        title="The work behind the numbers."
        description="Explore AI usage by project. Project details stay private to your account."
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
            title="Top projects by cost"
            description="Search your projects or sort any column to compare activity."
          >
            <DataTable
              rows={data.summary?.byProject ?? []}
              rowKey={(p) => p.projectPath}
              searchLabel="Find projects"
              emptyTitle="No projects"
              defaultSort={{ key: "totalCost", descending: true }}
              columns={[
                {
                  key: "projectPath",
                  label: "Project",
                  render: (p) => <span className="mono">{p.projectPath}</span>,
                },
                {
                  key: "totalTokens",
                  label: "Tokens",
                  render: (p) => fmtInt(p.totalTokens),
                },
                {
                  key: "totalCost",
                  label: "Cost",
                  render: (p) => fmtUsd(p.totalCost),
                },
                {
                  key: "sessions",
                  label: "Sessions",
                  render: (p) => fmtInt(p.sessions),
                },
              ]}
            />
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

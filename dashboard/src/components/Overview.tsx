import { AppShell } from "./AppShell";
import { FilterBar } from "./FilterBar";
import { TrendChart, CostBars } from "./Charts";
import { PageHeading, Panel, LoadingState, ErrorState } from "./ui";
import { useAnalytics } from "./useAnalytics";
import { fmtInt, fmtUsd } from "@/lib/format";

export function Overview() {
  const data = useAnalytics();
  const { summary, loading, error, retry } = data;
  const totals = summary?.totals;
  const rows = summary?.byDay ?? [];
  const series = (metric: "totalTokens" | "totalCost", title: string) => [
    { title, data: rows.map((d) => ({ x: d.day, y: d[metric] })) },
    ...(summary?.bySource ?? []).map((source) => ({
      title: source.source,
      data: rows.map((d) => ({
        x: d.day,
        y:
          summary?.byDaySource?.find(
            (s) => s.day === d.day && s.source === source.source,
          )?.[metric] ?? 0,
      })),
    })),
  ];
  return (
    <AppShell active="/overview">
      <PageHeading
        title="A clearer view of your usage."
        description="Understand your AI activity, spending, and the tools behind it."
        action={
          <a className="button" href="/settings">
            Connect a device ↗
          </a>
        }
      />
      <div className="stack">
        <Panel className="filter-panel">
          <FilterBar {...data} />
        </Panel>
        {error ? (
          <ErrorState message={error} retry={retry} />
        ) : loading ? (
          <LoadingState />
        ) : (
          <>
            <div className="metrics">
              {[
                {
                  label: "Total cost",
                  value: fmtUsd(totals?.totalCost ?? 0),
                  caption: "Estimated spend · USD",
                  icon: "$",
                  accent: true,
                },
                {
                  label: "Total tokens",
                  value: fmtInt(totals?.totalTokens ?? 0),
                  caption: "Across your selected sources",
                  icon: "◈",
                },
                {
                  label: "Sessions",
                  value: fmtInt(totals?.sessions ?? 0),
                  caption: "Conversations across your devices",
                  icon: "≋",
                },
              ].map((k) => (
                <section
                  key={k.label}
                  className={`panel metric ${k.accent ? "metric-accent" : ""}`}
                >
                  <p className="metric-label">{k.label}</p>
                  <span className="metric-icon" aria-hidden="true">
                    {k.icon}
                  </span>
                  <p className="metric-value">{k.value}</p>
                  <p className="metric-caption">{k.caption}</p>
                </section>
              ))}
            </div>
            <div className="chart-grid">
              <Panel
                title="Cost over time"
                description="Your daily spending, broken down by source."
              >
                <TrendChart
                  title="Cost over time"
                  series={series("totalCost", "Total cost (USD)")}
                  currency
                />
              </Panel>
              <Panel
                title="Tokens over time"
                description="A daily picture of your AI activity."
              >
                <TrendChart
                  title="Tokens over time"
                  series={series("totalTokens", "Total tokens")}
                />
              </Panel>
            </div>
            <Panel
              title="Where your usage comes from"
              description="Source contribution by estimated cost."
            >
              <CostBars
                title="Cost by source"
                rows={(summary?.bySource ?? []).map((s) => ({
                  label: s.source,
                  value: s.totalCost,
                }))}
              />
            </Panel>
          </>
        )}
      </div>
    </AppShell>
  );
}

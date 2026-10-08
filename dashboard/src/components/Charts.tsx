import { useId } from "react";
import { fmtInt, fmtUsd } from "@/lib/format";
import { EmptyState } from "./ui";
const COLORS = ["#21745b", "#c28945", "#7186b0", "#936fa3", "#658e88"];
interface Series {
  title: string;
  data: { x: string; y: number }[];
}
export function TrendChart({
  title,
  series,
  currency = false,
}: {
  title: string;
  series: Series[];
  currency?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const days = series[0]?.data ?? [];
  if (!days.length) return <EmptyState title="No data" />;
  const max = Math.max(1, ...series.flatMap((s) => s.data.map((d) => d.y)));
  const x = (i: number) =>
    days.length === 1 ? 360 : 55 + (i * 650) / (days.length - 1);
  const y = (value: number) => 205 - (value / max) * 165;
  const fmt = currency ? fmtUsd : fmtInt;
  return (
    <div className="trend-chart">
      <svg viewBox="0 0 740 250" role="img" aria-label={title}>
        <title>{title}</title>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS[0]} stopOpacity=".16" />
            <stop offset="100%" stopColor={COLORS[0]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1="55"
              x2="705"
              y1={y(max * t)}
              y2={y(max * t)}
              stroke="#e8ece6"
              strokeDasharray="4 5"
            />
            <text x="45" y={y(max * t) + 4} textAnchor="end">
              {fmt(max * t)}
            </text>
          </g>
        ))}
        {series.map((s, n) => (
          <g key={s.title}>
            {n === 0 && days.length > 1 && (
              <path
                d={`M ${x(0)} 205 ${s.data.map((d, i) => `L ${x(i)} ${y(d.y)}`).join(" ")} L ${x(days.length - 1)} 205 Z`}
                fill={`url(#${id})`}
              />
            )}
            <polyline
              points={s.data.map((d, i) => `${x(i)},${y(d.y)}`).join(" ")}
              stroke={COLORS[n % COLORS.length]}
              strokeWidth={n === 0 ? 3 : 2}
              fill="none"
              strokeLinejoin="round"
            />
            {s.data.map((d, i) => (
              <circle
                key={d.x}
                cx={x(i)}
                cy={y(d.y)}
                r={days.length > 60 ? 2 : 3.5}
                fill={COLORS[n % COLORS.length]}
              >
                <title>
                  {d.x}: {s.title} {fmt(d.y)}
                </title>
              </circle>
            ))}
          </g>
        ))}
        <text x="55" y="235">
          {days[0].x}
        </text>
        {days.length > 1 && (
          <text x="705" y="235" textAnchor="end">
            {days.at(-1)?.x}
          </text>
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s, i) => (
          <span key={s.title}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            {s.title}
          </span>
        ))}
      </div>
      <details className="chart-data">
        <summary>View chart data</summary>
        <div className="table-scroll">
          <table aria-label={`${title} data`}>
            <thead>
              <tr>
                <th>Day</th>
                {series.map((s) => (
                  <th key={s.title}>{s.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d.x}>
                  <td>{d.x}</td>
                  {series.map((s) => (
                    <td key={s.title}>{fmt(s.data[i]?.y ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
export function CostBars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  if (!rows.length) return <EmptyState title="No data" />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <div className="cost-bars" role="img" aria-label={title}>
      {rows.map((r, i) => (
        <div className="cost-row" key={`${r.label}-${i}`}>
          <div>
            <span>{r.label}</span>
            <strong>
              {fmtUsd(r.value)}{" "}
              <small>{total ? Math.round((r.value / total) * 100) : 0}%</small>
            </strong>
          </div>
          <div className="bar-track">
            <div
              style={{
                width: `${Math.max(0, (r.value / max) * 100)}%`,
                background: COLORS[i % COLORS.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

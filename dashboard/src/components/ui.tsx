import { useMemo, useState, type ReactNode } from "react";

export function PageHeading({
  eyebrow = "YOUR WORKSPACE",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Panel({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
export function EmptyState({
  title = "No data yet",
  description = "Sync a device to start exploring your usage.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">◈</span>
      <h3>{title}</h3>
      <p>{description}</p>
      <a href="/settings">Manage devices →</a>
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="alert alert-error" role="alert">
      <strong>Something went wrong</strong>
      <p>{message}</p>
      {retry && (
        <button className="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="loading-dot" />
      Loading your usage…
    </div>
  );
}
export interface Column<T> {
  key: keyof T & string;
  label: string;
  render: (row: T) => ReactNode;
}
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchLabel,
  emptyTitle = "No data",
  defaultSort,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchLabel?: string;
  emptyTitle?: string;
  defaultSort?: { key: keyof T & string; descending: boolean };
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(defaultSort);
  const items = useMemo(() => {
    const filtered = rows.filter(
      (row) =>
        !query ||
        columns.some((c) =>
          String(row[c.key] ?? "")
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    );
    if (sort)
      filtered.sort((a, b) => {
        const av = a[sort.key],
          bv = b[sort.key];
        const result =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.descending ? -result : result;
      });
    return filtered;
  }, [rows, columns, query, sort]);
  return (
    <div className="data-table">
      {searchLabel && (
        <div className="table-tools">
          <input
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>
            {items.length} of {rows.length} loaded
          </span>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    sort?.key === c.key
                      ? sort.descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button
                    onClick={() =>
                      setSort({
                        key: c.key,
                        descending:
                          sort?.key === c.key ? !sort.descending : false,
                      })
                    }
                  >
                    {c.label}
                    <span aria-hidden="true">
                      {sort?.key === c.key
                        ? sort.descending
                          ? " ↓"
                          : " ↑"
                        : " ↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <EmptyState
          title={query ? "No matches" : emptyTitle}
          description={
            query
              ? "Try a different search."
              : "Try a different date range or sync your devices."
          }
        />
      )}
    </div>
  );
}

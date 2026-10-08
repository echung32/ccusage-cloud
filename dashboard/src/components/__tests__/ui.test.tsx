import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DataTable, type Column } from "../ui";
import { TrendChart } from "../Charts";

const columns: Column<{ name: string; cost: number }>[] = [
  {
    key: "name",
    label: "Name",
    render: (r: { name: string; cost: number }) => r.name,
  },
  {
    key: "cost",
    label: "Cost",
    render: (r: { name: string; cost: number }) => r.cost,
  },
];
describe("workspace data presentation", () => {
  it("sorts numeric values and searches loaded rows", async () => {
    render(
      <DataTable
        rows={[
          { name: "alpha", cost: 2 },
          { name: "beta", cost: 10 },
        ]}
        columns={columns}
        rowKey={(r) => r.name}
        searchLabel="Find rows"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Cost/ }));
    expect(
      within(screen.getAllByRole("row")[1]).getByText("alpha"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Cost/ }));
    expect(
      within(screen.getAllByRole("row")[1]).getByText("beta"),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox"), "alpha");
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });
  it("renders a zero-valued single day with accessible values", () => {
    render(
      <TrendChart
        title="Tokens over time"
        series={[{ title: "Total tokens", data: [{ x: "2026-06-01", y: 0 }] }]}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Tokens over time" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Tokens over time data" }),
    ).toHaveTextContent("2026-06-01");
    expect(screen.getByRole("img").innerHTML).not.toMatch(/NaN|Infinity/);
  });
});

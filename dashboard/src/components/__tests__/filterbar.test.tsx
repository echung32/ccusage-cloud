import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterBar } from "../FilterBar";

describe("FilterBar", () => {
  it("emits a source change preserving the device", async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={{ device: "d1" }}
        sources={["cursor"]}
        devices={[]}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Source"), "cursor");
    expect(onChange).toHaveBeenCalledWith({ device: "d1", source: "cursor" });
  });
  it("clears filters", async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={{ source: "cursor" }}
        sources={["cursor"]}
        devices={[]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });
  it("reflects dates and emits inclusive UTC end dates", async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={{ from: "2026-06-01T00:00:00.000Z" }}
        sources={[]}
        devices={[]}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("From")).toHaveValue("2026-06-01");
    await userEvent.type(screen.getByLabelText("To"), "2026-06-25");
    expect(onChange).toHaveBeenLastCalledWith({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-25T23:59:59.999Z",
    });
  });
});

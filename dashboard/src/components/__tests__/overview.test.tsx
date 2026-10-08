import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overview } from "../Overview";

afterEach(() => vi.restoreAllMocks());

function routeFetch(map: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(map).find((k) => url.startsWith(k));
    return Promise.resolve(
      new Response(JSON.stringify(key ? map[key] : {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

describe("Overview", () => {
  it("surfaces a failed request instead of presenting zero totals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 500 })),
    );
    render(<Overview />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
  it("ignores an older request after the source changes", async () => {
    let resolveOld!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("/api/me"))
          return Promise.resolve(new Response(JSON.stringify({ devices: [] })));
        if (url.includes("source=cursor"))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totals: { sessions: 2, totalTokens: 222, totalCost: 2 },
                byDay: [],
                bySource: [],
              }),
            ),
          );
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      }),
    );
    render(<Overview />);
    await userEvent.selectOptions(screen.getByLabelText("Source"), "cursor");
    expect(await screen.findByText("222")).toBeInTheDocument();
    resolveOld(
      new Response(
        JSON.stringify({
          totals: { sessions: 9, totalTokens: 999, totalCost: 9 },
          byDay: [],
          bySource: [],
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("999")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("222")).toBeInTheDocument();
  });
  it("renders headline totals from the summary", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/me": {
          id: "u1",
          email: "a@b.c",
          publicToGroup: false,
          devices: [
            {
              id: "d1",
              label: "laptop",
              createdAt: 0,
              lastSeenAt: null,
              revokedAt: null,
            },
          ],
        },
        "/api/summary": {
          totals: {
            sessions: 3,
            totalTokens: 1465,
            inputTokens: 310,
            outputTokens: 155,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalCost: 3.5,
          },
          byDay: [{ day: "2026-06-20", totalTokens: 150, totalCost: 1 }],
          byDaySource: [
            {
              day: "2026-06-20",
              source: "claude-code",
              totalTokens: 150,
              totalCost: 1,
            },
          ],
          bySource: [
            {
              source: "claude-code",
              totalTokens: 150,
              totalCost: 1,
              sessions: 1,
            },
          ],
          byModel: [],
          byProject: [],
          byDevice: [],
        },
      }),
    );
    render(<Overview />);
    await waitFor(() => expect(screen.getByText("1,465")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/\$3\.50/)).toBeInTheDocument();
    // Assert the accessible chart, not only its underlying data table.
    expect(screen.getByLabelText("Tokens over time")).toBeInTheDocument();
    expect(screen.getByLabelText("Cost over time")).toBeInTheDocument();
    // Per-source breakdown: the source name shows up as a chart series (legend) alongside the total.
    expect(screen.getAllByText("claude-code").length).toBeGreaterThan(0);
  });
});

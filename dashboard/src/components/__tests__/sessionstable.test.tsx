import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionsTable } from "../SessionsTable";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("SessionsTable", () => {
  it("renders session rows in me scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("/api/me"))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "u1",
                email: "a@b.c",
                publicToGroup: false,
                devices: [],
              }),
              { status: 200 },
            ),
          );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessions: [
                {
                  source: "claude-code",
                  sessionId: "abc",
                  deviceId: "d1",
                  totalTokens: 100,
                  totalCost: 0.5,
                  firstActivity: null,
                  lastActivity: "2026-06-24T10:00:00Z",
                  modelsUsed: ["claude-opus-4-8"],
                  projectPath: "/p",
                },
              ],
              nextCursor: null,
            }),
            { status: 200 },
          ),
        );
      }),
    );
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText("abc")).toBeInTheDocument());
  });

  it("loads personal sessions on a legacy group URL", async () => {
    window.history.replaceState({}, "", "/sessions?scope=group");
    const f = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.startsWith("/api/me")
                ? { devices: [] }
                : {
                    sessions: [
                      {
                        source: "cursor",
                        sessionId: "personal",
                        deviceId: "d1",
                        totalTokens: 1,
                        totalCost: 0,
                        firstActivity: null,
                        lastActivity: null,
                        modelsUsed: [],
                        projectPath: "/mine",
                      },
                    ],
                    nextCursor: null,
                  },
            ),
            { status: 200 },
          ),
        ),
      );
    vi.stubGlobal("fetch", f);
    render(<SessionsTable />);
    await waitFor(() =>
      expect(screen.getByText("personal")).toBeInTheDocument(),
    );
    expect(f.mock.calls.some(([url]) => String(url).includes("scope="))).toBe(
      false,
    );
  });

  it("renders the property filter with accessible labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("/api/me"))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "u1",
                email: "a@b.c",
                publicToGroup: false,
                devices: [],
              }),
              { status: 200 },
            ),
          );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessions: [
                {
                  source: "claude-code",
                  sessionId: "abc",
                  deviceId: "d1",
                  totalTokens: 100,
                  totalCost: 0.5,
                  firstActivity: null,
                  lastActivity: "2026-06-24T10:00:00Z",
                  modelsUsed: ["claude-opus-4-8"],
                  projectPath: "/p",
                },
              ],
              nextCursor: null,
            }),
            { status: 200 },
          ),
        );
      }),
    );
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText("abc")).toBeInTheDocument());
    // i18nStrings.filteringAriaLabel is applied to the search input.
    expect(screen.getByLabelText("Find sessions")).toBeInTheDocument();
  });

  it("narrows visible rows using search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("/api/me"))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "u1",
                email: "a@b.c",
                publicToGroup: false,
                devices: [],
              }),
              { status: 200 },
            ),
          );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessions: [
                {
                  source: "claude-code",
                  sessionId: "s1",
                  deviceId: "d1",
                  totalTokens: 100,
                  totalCost: 0.5,
                  firstActivity: null,
                  lastActivity: "2026-06-24T10:00:00Z",
                  modelsUsed: ["claude-opus-4-8"],
                  projectPath: "/p1",
                },
                {
                  source: "cursor",
                  sessionId: "s2",
                  deviceId: "d1",
                  totalTokens: 200,
                  totalCost: 1.0,
                  firstActivity: null,
                  lastActivity: "2026-06-24T11:00:00Z",
                  modelsUsed: ["gpt-4"],
                  projectPath: "/p2",
                },
              ],
              nextCursor: null,
            }),
            { status: 200 },
          ),
        );
      }),
    );
    render(<SessionsTable />);
    // Both rows visible initially.
    await waitFor(() => expect(screen.getByText("s1")).toBeInTheDocument());
    expect(screen.getByText("s2")).toBeInTheDocument();

    // Type 'cursor' into the PropertyFilter input and select the free-text option.
    const filterInput = screen.getByLabelText("Find sessions");
    await userEvent.type(filterInput, "cursor");

    // After filtering, only the 'cursor' row should remain.
    await waitFor(() =>
      expect(screen.queryByText("s1")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("s2")).toBeInTheDocument();
  });

  it("keeps sibling rows distinct when source+sessionId match but projectPath differs", async () => {
    // Siblings arrive across a PAGINATION boundary: first page returns /repo with
    // nextCursor='c1'; loadMore returns /repo/.worktree with nextCursor=null.
    // This forces a state-update reconcile where Cloudscape re-keys rows via
    // trackBy — a stronger signal than initial mount.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("/api/me")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "u1",
                email: "a@b.c",
                publicToGroup: false,
                devices: [],
              }),
              { status: 200 },
            ),
          );
        }
        // Branch on cursor query param to distinguish first vs loadMore sessions call.
        if (url.includes("cursor=c1")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sessions: [
                  {
                    source: "claude-code",
                    sessionId: "shared-id",
                    deviceId: "d1",
                    totalTokens: 200,
                    totalCost: 1.0,
                    firstActivity: null,
                    lastActivity: "2026-06-24T11:00:00Z",
                    modelsUsed: ["claude-opus-4-8"],
                    projectPath: "/repo/.worktree",
                  },
                ],
                nextCursor: null,
              }),
              { status: 200 },
            ),
          );
        }
        // First page: one row, non-null cursor so "Load more" footer appears.
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessions: [
                {
                  source: "claude-code",
                  sessionId: "shared-id",
                  deviceId: "d1",
                  totalTokens: 100,
                  totalCost: 0.5,
                  firstActivity: null,
                  lastActivity: "2026-06-24T10:00:00Z",
                  modelsUsed: ["claude-opus-4-8"],
                  projectPath: "/repo",
                },
              ],
              nextCursor: "c1",
            }),
            { status: 200 },
          ),
        );
      }),
    );

    render(<SessionsTable />);

    // First page loaded: /repo visible, Load more button present.
    await waitFor(() => expect(screen.getByText("/repo")).toBeInTheDocument());
    const loadMoreBtn = screen.getByRole("button", { name: /load more/i });
    await userEvent.click(loadMoreBtn);

    // After loadMore reconcile: BOTH siblings must remain in the document.
    await waitFor(() =>
      expect(screen.getByText("/repo/.worktree")).toBeInTheDocument(),
    );
    expect(screen.getByText("/repo")).toBeInTheDocument();
  });
});

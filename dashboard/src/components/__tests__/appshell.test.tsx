import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../AppShell";

describe("personal workspace navigation", () => {
  it("keeps all personal views available on a legacy group URL", () => {
    window.history.replaceState({}, "", "/overview?scope=group");
    render(
      <AppShell active="/overview">
        <p>Content</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute(
      "href",
      "/sessions",
    );
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByRole("link", { name: "Group" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("Content");
  });
});

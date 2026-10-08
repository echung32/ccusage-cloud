import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDevices } from "../SettingsDevices";

afterEach(() => vi.restoreAllMocks());
const me = {
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
};

describe("SettingsDevices", () => {
  it("preserves the label and shows feedback when creating a device fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            new Response(JSON.stringify(url === "/api/me" ? me : {}), {
              status: url === "/api/me" ? 200 : 500,
            }),
          ),
        ),
    );
    render(<SettingsDevices />);
    await screen.findByText("laptop");
    await userEvent.type(screen.getByLabelText("new device label"), "phone");
    await userEvent.click(screen.getByRole("button", { name: /add device/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to complete",
    );
    expect(screen.getByLabelText("new device label")).toHaveValue("phone");
  });
  it("lists private devices without a sharing control", async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/me") && init?.method === "PATCH")
        return Promise.resolve(
          new Response(JSON.stringify({ publicToGroup: true }), {
            status: 200,
          }),
        );
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal("fetch", f);
    render(<SettingsDevices />);
    await waitFor(() => expect(screen.getByText("laptop")).toBeInTheDocument());
    expect(screen.queryByText(/share my usage/i)).not.toBeInTheDocument();
    expect(screen.getByText(/usage is private/i)).toBeInTheDocument();
  });

  it("adds a device and shows the token once", async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/devices" && init?.method === "POST")
        return Promise.resolve(
          new Response(JSON.stringify({ id: "d2", token: "cccloud_secret" }), {
            status: 200,
          }),
        );
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal("fetch", f);
    render(<SettingsDevices />);
    await waitFor(() => screen.getByText("laptop"));
    await userEvent.type(screen.getByLabelText("new device label"), "phone");
    await userEvent.click(screen.getByRole("button", { name: /add device/i }));
    await waitFor(() =>
      expect(screen.getByText("cccloud_secret")).toBeInTheDocument(),
    );
  });

  it("renames a device inline", async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/devices/d1" && init?.method === "PATCH")
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal("fetch", f);
    render(<SettingsDevices />);
    await waitFor(() => expect(screen.getByText("laptop")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /edit laptop/i }));
    const input = await screen.findByLabelText("device name input");
    await userEvent.clear(input);
    await userEvent.type(input, "workstation{Enter}");
    await waitFor(() =>
      expect(f).toHaveBeenCalledWith(
        "/api/devices/d1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });
});

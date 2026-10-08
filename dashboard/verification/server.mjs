import { createServer } from "node:http";
import { initialDevices, sessions, summaryFor } from "./fixtures.mjs";
let devices = structuredClone(initialDevices);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4322");
  const reply = (body, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  try {
    if (url.pathname === "/__verification/reset" && req.method === "POST") {
      devices = structuredClone(initialDevices);
      return reply({ ok: true });
    }
    if (!url.pathname.startsWith("/api/")) {
      const response = await fetch(
        `http://127.0.0.1:4321${url.pathname}${url.search}`,
      );
      res.writeHead(
        response.status,
        Object.fromEntries(
          [...response.headers].filter(
            ([key]) =>
              ![
                "content-encoding",
                "content-length",
                "transfer-encoding",
              ].includes(key),
          ),
        ),
      );
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/api/me" && req.method === "GET")
      return reply({ id: "demo-user", email: "demo@example.test", devices });
    if (url.pathname === "/api/summary")
      return reply(summaryFor(Object.fromEntries(url.searchParams), devices));
    if (url.pathname === "/api/sessions") {
      const f = Object.fromEntries(url.searchParams);
      const rows = sessions
        .filter(
          (s) =>
            (!f.source || s.source === f.source) &&
            (!f.device || s.deviceId === f.device) &&
            (!f.from || s.lastActivity >= f.from) &&
            (!f.to || s.lastActivity <= f.to),
        )
        .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
      const offset = Number(f.cursor ?? 0);
      return reply({
        sessions: rows.slice(offset, offset + 12),
        nextCursor: offset + 12 < rows.length ? String(offset + 12) : null,
      });
    }
    if (url.pathname === "/api/devices" && req.method === "POST") {
      const id = `demo-${Date.now()}`;
      devices.push({
        id,
        label: body.label,
        createdAt: Date.now(),
        lastSeenAt: null,
        revokedAt: null,
      });
      return reply({ id, token: "cccloud_SYNTHETIC_DEMO_TOKEN_NOT_VALID" });
    }
    if (url.pathname.startsWith("/api/devices/")) {
      const device = devices.find(
        (d) => d.id === url.pathname.split("/").at(-1),
      );
      if (!device) return reply({ error: "not found" }, 404);
      if (req.method === "PATCH") device.label = body.label;
      else if (req.method === "DELETE") device.revokedAt = Date.now();
      else return reply({ error: "not found" }, 404);
      return reply({ ok: true });
    }
    if (url.pathname === "/api/enroll-codes")
      return reply({
        code: "SYNTHETIC_DEMO_CODE",
        expiresAt: Date.now() + 900000,
      });
    return reply({ error: "not found" }, 404);
  } catch (error) {
    console.error(error.message);
    reply({ error: "demo server failure" }, 500);
  }
});
server.listen(4322, "127.0.0.1", () =>
  console.log(
    "Synthetic review workspace: http://127.0.0.1:4322 (requires Astro preview on :4321)",
  ),
);

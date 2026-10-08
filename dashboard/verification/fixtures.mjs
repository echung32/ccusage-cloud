// Deterministic synthetic data. Never use real tokens or account data in recordings.
export const initialDevices = [
  {
    id: "d1",
    label: "Work MacBook",
    createdAt: 1780000000000,
    lastSeenAt: 1791411000000,
    revokedAt: null,
  },
  {
    id: "d2",
    label: "Home workstation",
    createdAt: 1780000000000,
    lastSeenAt: 1791407400000,
    revokedAt: null,
  },
];
export const sessions = Array.from({ length: 24 }, (_, i) => ({
  source: ["claude-code", "codex", "cursor"][i % 3],
  sessionId: `session-${String(i + 1).padStart(3, "0")}`,
  deviceId: i % 2 ? "d2" : "d1",
  totalTokens: 12000 + i * 1250,
  inputTokens: 6000,
  outputTokens: 6000,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalCost: Number((0.6 + i * 0.17).toFixed(2)),
  firstActivity: `2026-10-${String(1 + (i % 7)).padStart(2, "0")}T09:00:00.000Z`,
  lastActivity: `2026-10-${String(1 + (i % 7)).padStart(2, "0")}T11:30:00.000Z`,
  modelsUsed: [
    i % 3 === 0
      ? "claude-sonnet-4.5"
      : i % 3 === 1
        ? "gpt-5"
        : "claude-haiku-4.5",
  ],
  projectPath: [
    "/workspace/ccusage-cloud",
    "/workspace/design-system",
    "/workspace/api-service",
    "/workspace/docs",
  ][i % 4],
}));
export function summaryFor(filters, devices) {
  const rows = sessions.filter(
    (s) =>
      (!filters.source || s.source === filters.source) &&
      (!filters.device || s.deviceId === filters.device) &&
      (!filters.from || s.lastActivity >= filters.from) &&
      (!filters.to || s.lastActivity <= filters.to),
  );
  const totals = rows.reduce(
    (t, s) => ({
      sessions: t.sessions + 1,
      totalTokens: t.totalTokens + s.totalTokens,
      totalCost: t.totalCost + s.totalCost,
      inputTokens: t.inputTokens + s.inputTokens,
      outputTokens: t.outputTokens + s.outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    }),
    {
      sessions: 0,
      totalTokens: 0,
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
  );
  const grouped = (key) =>
    Object.entries(Object.groupBy(rows, key))
      .map(([label, items]) => ({
        label,
        totalTokens: items.reduce((n, s) => n + s.totalTokens, 0),
        totalCost: items.reduce((n, s) => n + s.totalCost, 0),
        sessions: items.length,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);
  return {
    totals,
    bySource: grouped((s) => s.source).map(({ label, ...r }) => ({
      source: label,
      ...r,
    })),
    byModel: grouped((s) => s.modelsUsed[0]).map(({ label, ...r }) => ({
      model: label,
      ...r,
    })),
    byProject: grouped((s) => s.projectPath).map(({ label, ...r }) => ({
      projectPath: label,
      ...r,
    })),
    byDevice: grouped((s) => s.deviceId).map(({ label, ...r }) => ({
      deviceId: label,
      label: devices.find((d) => d.id === label)?.label ?? label,
      ...r,
    })),
    byDay: grouped((s) => s.lastActivity.slice(0, 10))
      .map(({ label, ...r }) => ({ day: label, ...r }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byDaySource: grouped(
      (s) => `${s.lastActivity.slice(0, 10)}|${s.source}`,
    ).map(({ label, ...r }) => ({
      day: label.split("|")[0],
      source: label.split("|")[1],
      ...r,
    })),
  };
}

export interface ModelStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

// Convert a `models` object (codex shape: keyed by model name, no per-model cost)
// into the `modelBreakdowns` array shape the worker/dashboard consume.
// Single-model sessions get the full session cost (exact); multi-model sessions
// apportion cost by token share (estimate). reasoningOutputTokens is already part
// of outputTokens upstream, so token fields are copied straight across.
export function synthesizeBreakdowns(
  models: Record<string, ModelStats>,
  totalCost: number,
): ModelBreakdown[] | undefined {
  const entries = Object.entries(models);
  if (entries.length === 0) return undefined;
  const totalTokens = entries.reduce((sum, [, m]) => sum + m.totalTokens, 0);
  return entries.map(([modelName, m]) => ({
    modelName,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreationTokens: m.cacheCreationTokens,
    cacheReadTokens: m.cacheReadTokens,
    cost:
      entries.length === 1
        ? totalCost
        : totalTokens > 0
          ? totalCost * (m.totalTokens / totalTokens)
          : totalCost / entries.length,
  }));
}

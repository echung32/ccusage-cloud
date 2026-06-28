import { describe, expect, it } from 'vitest';
import { loadDaily } from '../src/daily';
import type { Runner } from '../src/ccusage';

const claudeDaily = JSON.stringify({
  daily: [
    { date: '2026-06-08', totalTokens: 100, totalCost: 0.5, modelsUsed: ['claude-opus-4-8'] },
    { date: '2026-06-09', totalTokens: 200, totalCost: 1.0, modelsUsed: ['claude-opus-4-8'] },
    { totalTokens: 999, totalCost: 9.9 }, // no date → skipped
  ],
});
const codexDaily = JSON.stringify({ daily: [{ date: '2026-06-24', totalTokens: 50, costUSD: 0.2 }] });

describe('loadDaily', () => {
  it('parses claude daily rows and skips rows without a date', () => {
    const run: Runner = () => claudeDaily;
    const rows = loadDaily('claude', 'ccusage', run);
    expect(rows).toEqual([
      { source: 'claude', day: '2026-06-08', totalTokens: 100, totalCost: 0.5 },
      { source: 'claude', day: '2026-06-09', totalTokens: 200, totalCost: 1.0 },
    ]);
  });

  it('resolves cost from costUSD when totalCost is absent (codex)', () => {
    const run: Runner = () => codexDaily;
    const rows = loadDaily('codex', 'ccusage', run);
    expect(rows).toEqual([{ source: 'codex', day: '2026-06-24', totalTokens: 50, totalCost: 0.2 }]);
  });

  it('returns [] when the runner throws (source not installed)', () => {
    const run: Runner = () => { throw new Error('not found'); };
    expect(loadDaily('opencode', 'ccusage', run)).toEqual([]);
  });
});

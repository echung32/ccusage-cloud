import { describe, expect, it } from 'vitest';
import { synthesizeBreakdowns, type ModelStats } from '../src/model-breakdowns';

const stats = (over: Partial<ModelStats> = {}) => ({
  inputTokens: 100, outputTokens: 20, cacheCreationTokens: 0,
  cacheReadTokens: 80, totalTokens: 200, ...over,
});

describe('synthesizeBreakdowns', () => {
  it('single model: per-model cost equals session totalCost', () => {
    const out = synthesizeBreakdowns({ 'gpt-5.5': stats() }, 1.5);
    expect(out).toEqual([
      { modelName: 'gpt-5.5', inputTokens: 100, outputTokens: 20,
        cacheCreationTokens: 0, cacheReadTokens: 80, cost: 1.5 },
    ]);
  });

  it('single model: token fields map straight across (reasoning not added)', () => {
    // outputTokens stays 20 even though a real payload also carries reasoningOutputTokens
    const out = synthesizeBreakdowns({ 'gpt-5.5': stats({ outputTokens: 20 }) }, 1)!;
    expect(out[0].outputTokens).toBe(20);
  });

  it('multi model: costs apportion by totalTokens share and sum to totalCost', () => {
    const out = synthesizeBreakdowns({
      a: stats({ totalTokens: 300 }),
      b: stats({ totalTokens: 100 }),
    }, 4)!;
    const byName = Object.fromEntries(out.map((m) => [m.modelName, m.cost]));
    expect(byName.a).toBeCloseTo(3); // 300/400 * 4
    expect(byName.b).toBeCloseTo(1); // 100/400 * 4
    expect(out.reduce((s, m) => s + m.cost, 0)).toBeCloseTo(4);
  });

  it('multi model with zero total tokens: splits cost evenly', () => {
    const out = synthesizeBreakdowns({
      a: stats({ totalTokens: 0 }),
      b: stats({ totalTokens: 0 }),
    }, 2)!;
    expect(out.map((m) => m.cost)).toEqual([1, 1]);
  });

  it('empty models object: returns undefined', () => {
    expect(synthesizeBreakdowns({}, 1)).toBeUndefined();
  });
});

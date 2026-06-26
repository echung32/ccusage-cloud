import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadSessions, type Runner } from '../src/ccusage';

const fixture = readFileSync(join(__dirname, '../fixtures/claude-session.json'), 'utf8');

describe('loadSessions', () => {
  it('parses, tags source, and drops null sessionId rows', () => {
    const run: Runner = () => fixture;
    const out = loadSessions('claude', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'claude',
      sessionId: 'sess-aaa',
      totalCost: 0.42,
      projectPath: '/home/me/work/app',
    });
  });

  it('passes the right ccusage args', () => {
    const calls: string[][] = [];
    const run: Runner = (_bin, args) => {
      calls.push(args);
      return fixture;
    };
    loadSessions('claude', 'ccusage', run);
    expect(calls[0]).toEqual(['claude', 'session', '--json']);
  });

  it('returns [] when the runner throws (source missing)', () => {
    const run: Runner = () => {
      throw new Error('command not found');
    };
    expect(loadSessions('claude', 'ccusage', run)).toEqual([]);
  });

  it('returns [] on non-JSON output', () => {
    const run: Runner = () => 'not json';
    expect(loadSessions('claude', 'ccusage', run)).toEqual([]);
  });
});

describe('loadSessions codex/costUSD + resilience', () => {
  it('maps costUSD to totalCost when totalCost is absent', () => {
    const run: Runner = () => JSON.stringify({ sessions: [{
      sessionId: 'cx1', inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0,
      cacheReadTokens: 3, totalTokens: 6, costUSD: 0.78,
    }] });
    const out = loadSessions('codex', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].totalCost).toBeCloseTo(0.78);
    expect(out[0].source).toBe('codex');
  });

  it('keeps valid rows and warns instead of dropping the whole source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run: Runner = () => JSON.stringify({ sessions: [
      { sessionId: 'ok', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.1 },
      { sessionId: 'bad', inputTokens: 'NOPE' },
    ] });
    const out = loadSessions('claude', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe('ok');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

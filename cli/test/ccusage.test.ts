import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadSessions, type Runner } from '../src/ccusage';

const fixture = readFileSync(join(__dirname, '../fixtures/claude-session.json'), 'utf8');
const codexFixture = readFileSync(join(__dirname, '../fixtures/codex-session.json'), 'utf8');

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

  it('prefers totalCost over costUSD when both fields are present', () => {
    const run: Runner = () => JSON.stringify({ sessions: [{
      sessionId: 'cx2', inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0,
      cacheReadTokens: 3, totalTokens: 6, totalCost: 0.5, costUSD: 0.78,
    }] });
    const out = loadSessions('codex', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].totalCost).toBeCloseTo(0.5);
  });

  it('emits exact warning text and count when multiple rows fail schema validation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run: Runner = () => JSON.stringify({ sessions: [
      { sessionId: 'good', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.1 },
      { sessionId: 'bad1', inputTokens: 'NOPE' },
      { sessionId: 'bad2', outputTokens: 'NOPE' },
    ] });
    const out = loadSessions('claude', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe('good');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('ccusage claude: skipped 2 session(s) that failed validation');
    warn.mockRestore();
  });

  it('drops null-sessionId rows silently without incrementing the validation-failure counter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run: Runner = () => JSON.stringify({ sessions: [
      { sessionId: 'real', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.2 },
      { sessionId: null, inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.1 },
    ] });
    const out = loadSessions('claude', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe('real');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('loadSessions codex modelBreakdowns synthesis', () => {
  it('synthesizes modelBreakdowns from the codex models object', () => {
    const run: Runner = () => codexFixture;
    const out = loadSessions('codex', 'ccusage', run);
    expect(out).toHaveLength(1);
    expect(out[0].modelBreakdowns).toEqual([
      {
        modelName: 'gpt-5.5',
        inputTokens: 86548,
        outputTokens: 6985,
        cacheCreationTokens: 0,
        cacheReadTokens: 281472,
        cost: 0.783026, // single model -> full session cost (costUSD)
      },
    ]);
  });

  it('does not leak the raw models object onto the tagged session', () => {
    const run: Runner = () => codexFixture;
    const out = loadSessions('codex', 'ccusage', run);
    expect('models' in out[0]).toBe(false);
  });

  it('leaves an existing modelBreakdowns untouched (claude path)', () => {
    const run: Runner = () => fixture; // claude fixture, already has modelBreakdowns
    const out = loadSessions('claude', 'ccusage', run);
    expect(out[0].modelBreakdowns).toEqual([
      { modelName: 'claude-opus-4-8', cost: 0.42 },
    ]);
  });

  it('preserves modelBreakdowns key position for sessions that already have it (stable hash)', () => {
    const run: Runner = () => fixture; // claude fixture: already has modelBreakdowns + projectPath
    const out = loadSessions('claude', 'ccusage', run);
    const keys = Object.keys(out[0]);
    expect(keys.indexOf('modelBreakdowns')).toBeLessThan(keys.indexOf('projectPath'));
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

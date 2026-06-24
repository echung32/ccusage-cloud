import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { syncOnce } from '../src/sync';
import type { Runner } from '../src/ccusage';
import type { Config } from '../src/config';
import { loadState } from '../src/state';

const cfg: Config = { serverUrl: 'https://api.example.dev', token: 'cccloud_xyz', ccusageBin: 'ccusage' };

function fixture(n: number): string {
  const sessions = Array.from({ length: n }, (_, i) => ({
    sessionId: `s${i}`,
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 2,
    totalCost: 0.1,
    firstActivity: 'a',
    lastActivity: 'b',
    modelsUsed: [],
    modelBreakdowns: [],
    projectPath: '/p',
  }));
  return JSON.stringify({ sessions, totals: {} });
}
const runN = (n: number): Runner => () => fixture(n);
const ok = () => new Response(JSON.stringify({ upserted: 1, skipped: 0 }), { status: 200 });

function tmpState(): string {
  return join(mkdtempSync(join(tmpdir(), 'ccc-sync-')), 'state.json');
}

describe('syncOnce', () => {
  it('posts changed sessions and records state; a second run skips them', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => ok());
    const first = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath });
    expect(first).toEqual({ pushed: 1, skipped: 0, chunks: 1 });
    expect(loadState(statePath).lastSyncAt).not.toBeNull();

    const second = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath });
    expect(second).toEqual({ pushed: 0, skipped: 1, chunks: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1); // not called again
  });

  it('--full re-sends everything regardless of state', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => ok());
    await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath });
    const full = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath, full: true });
    expect(full.pushed).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('chunks into batches of chunkSize', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => ok());
    const res = await syncOnce(cfg, ['claude'], { run: runN(3), fetchFn: fetchFn as unknown as typeof fetch, statePath, chunkSize: 2 });
    expect(res).toEqual({ pushed: 3, skipped: 0, chunks: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx then succeeds, and persists state only after success', async () => {
    const statePath = tmpState();
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response('boom', { status: 503 }) : ok();
    });
    const res = await syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath, retries: 2 });
    expect(res.pushed).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(Object.keys(loadState(statePath).hashes)).toHaveLength(1);
  });

  it('does not persist hashes for a batch the server permanently rejects', async () => {
    const statePath = tmpState();
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      syncOnce(cfg, ['claude'], { run: runN(1), fetchFn: fetchFn as unknown as typeof fetch, statePath, retries: 2 }),
    ).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1); // 4xx not retried
    expect(loadState(statePath).hashes).toEqual({});
  });

  it('redacts projectPath before push when cfg.redactProjects is set', async () => {
    const run = () => JSON.stringify({ sessions: [{ sessionId: 's1', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0, projectPath: '/work/secret' }] });
    let sentBody = '';
    const fetchFn = (async (_url: string | URL, init?: RequestInit) => { sentBody = String(init?.body ?? ''); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const cfg2 = { serverUrl: 'https://x.dev', token: 't', ccusageBin: 'ccusage', redactProjects: true };
    await syncOnce(cfg2, ['claude'], { run, fetchFn, full: true, statePath: `${process.env.TMPDIR ?? '/tmp'}/redact-state-${Math.random()}.json` });
    expect(sentBody).not.toContain('/work/secret');
    expect(sentBody).toMatch(/[0-9a-f]{64}/);
  });
});

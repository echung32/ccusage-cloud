import { describe, expect, it, vi } from 'vitest';
import { syncDaily } from '../src/sync';
import type { Runner } from '../src/ccusage';
import type { Config } from '../src/config';

const cfg: Config = { serverUrl: 'https://api.example.dev', token: 'cccloud_xyz', ccusageBin: 'ccusage' };
const ok = () => new Response(JSON.stringify({ upserted: 1 }), { status: 200 });
const dailyJson = JSON.stringify({ daily: [{ date: '2025-08-29', totalTokens: 100, totalCost: 0.5 }] });

describe('syncDaily', () => {
  it('posts daily rows to /ingest/daily and reports the count', async () => {
    const run: Runner = () => dailyJson;
    let url = '';
    let body = '';
    const fetchFn = vi.fn(async (u: string | URL, init?: RequestInit) => {
      url = String(u);
      body = String(init?.body ?? '');
      return ok();
    });
    const res = await syncDaily(cfg, ['claude'], { run, fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toEqual({ dailyPushed: 1 });
    expect(url).toBe('https://api.example.dev/ingest/daily');
    expect(JSON.parse(body)).toEqual({ days: [{ source: 'claude', day: '2025-08-29', totalTokens: 100, totalCost: 0.5 }] });
  });

  it('makes no request when there are no daily rows', async () => {
    const run: Runner = () => { throw new Error('no data'); };
    const fetchFn = vi.fn(async () => ok());
    const res = await syncDaily(cfg, ['opencode'], { run, fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toEqual({ dailyPushed: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

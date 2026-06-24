import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { syncOnce } from '../src/sync';
import type { Runner } from '../src/ccusage';
import type { Config } from '../src/config';

const fixture = readFileSync(join(__dirname, '../fixtures/claude-session.json'), 'utf8');
const cfg: Config = { serverUrl: 'https://api.example.dev', token: 'cccloud_xyz', ccusageBin: 'ccusage' };
const run: Runner = () => fixture;

describe('syncOnce', () => {
  it('posts tagged sessions to /ingest with the bearer token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ upserted: 1, skipped: 0 }), { status: 200 }));

    const result = await syncOnce(cfg, ['claude'], run, fetchFn as unknown as typeof fetch);

    expect(result).toEqual({ pushed: 1 });
    const calls = fetchFn.mock.calls as unknown as [URL, RequestInit][];
    const [url, init] = calls[0]!;
    expect(String(url)).toBe('https://api.example.dev/ingest');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer cccloud_xyz');
    const body = JSON.parse(init.body as string);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].source).toBe('claude');
  });

  it('does not call fetch when there are no sessions', async () => {
    const fetchFn = vi.fn();
    const empty: Runner = () => '{"sessions":[],"totals":{}}';
    const result = await syncOnce(cfg, ['claude'], empty, fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ pushed: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws when the server responds non-2xx', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(syncOnce(cfg, ['claude'], run, fetchFn as unknown as typeof fetch)).rejects.toThrow(/401/);
  });
});

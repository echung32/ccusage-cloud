import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { enrollDevice } from '../src/enroll';

function tmpConfig(): string {
  return join(mkdtempSync(join(tmpdir(), 'ccc-enroll-')), 'config.json');
}

describe('enrollDevice', () => {
  it('redeems a code, writes config, and defaults label to hostname', async () => {
    const configPath = tmpConfig();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: 'dev_1', token: 'cccloud_abc' }), { status: 200 }));
    const res = await enrollDevice({
      serverUrl: 'https://api.example.dev',
      code: 'ec_xyz',
      fetchFn: fetchFn as unknown as typeof fetch,
      configPath,
    });
    expect(res.token).toBe('cccloud_abc');

    const call = fetchFn.mock.calls[0];
    expect(String(call[0])).toBe('https://api.example.dev/api/enroll');
    const sentBody = JSON.parse((call[1] as RequestInit).body as string);
    expect(sentBody.code).toBe('ec_xyz');
    expect(sentBody.label).toBe(hostname());

    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(cfg).toMatchObject({ serverUrl: 'https://api.example.dev', token: 'cccloud_abc', ccusageBin: 'ccusage', redactProjects: false });
  });

  it('throws a clear message when the code is expired/used (410)', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 410 }));
    await expect(
      enrollDevice({ serverUrl: 'https://api.example.dev', code: 'ec_dead', fetchFn: fetchFn as unknown as typeof fetch, configPath: tmpConfig() }),
    ).rejects.toThrow(/expired or already used/i);
  });
});

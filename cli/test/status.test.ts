import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/index';
import type { Runner } from '../src/ccusage';

const fixture = JSON.stringify({
  sessions: [
    { sessionId: 's1', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.1, firstActivity: 'a', lastActivity: 'b', modelsUsed: [], modelBreakdowns: [], projectPath: '/p' },
  ],
  totals: {},
});

describe('status command', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ccc-status-'));
    process.env.XDG_CONFIG_HOME = dir;
    mkdirSync(join(dir, 'ccusage-cloud'), { recursive: true });
    writeFileSync(
      join(dir, 'ccusage-cloud', 'config.json'),
      JSON.stringify({ serverUrl: 'https://x.dev', token: 'cccloud_t', ccusageBin: 'ccusage' }),
    );
  });
  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    vi.restoreAllMocks();
  });

  it('reports pending sessions and never-synced state', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runner: Runner = (_bin, args) => (args[0] === 'claude' ? fixture : '{"sessions":[]}');
    const code = await run(['status', '--source', 'claude'], runner);
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('Server:    https://x.dev');
    expect(out).toContain('Last sync: never');
    expect(out).toContain('Pending:   1 session(s)');
  });
});

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, saveConfig, type Config } from '../src/config';

describe('config', () => {
  it('round-trips a saved config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccusage-cloud-'));
    const path = join(dir, 'config.json');
    const cfg: Config = { serverUrl: 'https://x.dev', token: 'cccloud_abc', ccusageBin: 'ccusage' };

    saveConfig(cfg, path);
    expect(loadConfig(path)).toEqual(cfg);
    expect(readFileSync(path, 'utf8')).toContain('cccloud_abc');
  });

  it('returns null when no config exists', () => {
    expect(loadConfig(join(tmpdir(), 'does-not-exist-xyz', 'config.json'))).toBeNull();
  });
});

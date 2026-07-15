import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybeSelfUpdate, loadEtag, saveEtag } from '../src/selfupdate';

const OLD = 'console.log("old cli")\n';
const NEW = 'console.log("new cli")\n';

function tmpdirFor(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A temp workspace: a cli.js file, a config.json pointing at a server, and an etag path.
function workspace(cliBody = OLD) {
  const dir = tmpdirFor('ccc-su-');
  const cliPath = join(dir, 'cli.js');
  const configPath = join(dir, 'config.json');
  const etagPath = join(dir, 'cli.etag');
  writeFileSync(cliPath, cliBody);
  writeFileSync(
    configPath,
    JSON.stringify({ serverUrl: 'https://api.example.dev', token: 't', ccusageBin: 'ccusage' }),
  );
  return { dir, cliPath, configPath, etagPath };
}

afterEach(() => {
  delete process.env.CCUSAGE_CLOUD_NO_SELF_UPDATE;
});

describe('maybeSelfUpdate', () => {
  it('replaces cli.js and stores the ETag on a 200 with new content', async () => {
    const ws = workspace();
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200, headers: { etag: '"v2"' } }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(true);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(NEW);
    expect(loadEtag(ws.etagPath)).toBe('"v2"');
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://api.example.dev/cli.js');
  });

  it('sends a stored ETag as If-None-Match and no-ops on 304', async () => {
    const ws = workspace();
    saveEtag('"v1"', ws.etagPath);
    const fetchFn = vi.fn(async () => new Response(null, { status: 304 }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(OLD);
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('"v1"');
  });

  it('does not rewrite when 200 body is identical, but stores the ETag', async () => {
    const ws = workspace(OLD);
    const fetchFn = vi.fn(async () => new Response(OLD, { status: 200, headers: { etag: '"same"' } }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(loadEtag(ws.etagPath)).toBe('"same"');
  });

  it('no-ops when the target is not named cli.js', async () => {
    const ws = workspace();
    const other = join(ws.dir, 'vitest-runner.js');
    writeFileSync(other, OLD);
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200 }));
    const updated = await maybeSelfUpdate({
      cliPath: other,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('no-ops (no network) when the opt-out env var is set', async () => {
    process.env.CCUSAGE_CLOUD_NO_SELF_UPDATE = '1';
    const ws = workspace();
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200 }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('no-ops when there is no config', async () => {
    const dir = tmpdirFor('ccc-su-');
    const cliPath = join(dir, 'cli.js');
    writeFileSync(cliPath, OLD);
    const fetchFn = vi.fn(async () => new Response(NEW, { status: 200 }));
    const updated = await maybeSelfUpdate({
      cliPath,
      configPath: join(dir, 'missing.json'),
      etagPath: join(dir, 'cli.etag'),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('swallows fetch errors and leaves the file untouched', async () => {
    const ws = workspace();
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(OLD);
  });

  it('never writes an empty body over cli.js', async () => {
    const ws = workspace();
    const fetchFn = vi.fn(async () => new Response('   ', { status: 200, headers: { etag: '"blank"' } }));
    const updated = await maybeSelfUpdate({
      cliPath: ws.cliPath,
      configPath: ws.configPath,
      etagPath: ws.etagPath,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updated).toBe(false);
    expect(readFileSync(ws.cliPath, 'utf8')).toBe(OLD);
  });
});

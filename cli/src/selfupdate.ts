import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { loadConfig } from './config';

export function etagPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'ccusage-cloud', 'cli.etag');
}

export function loadEtag(path = etagPath()): string | null {
  if (!existsSync(path)) return null;
  const v = readFileSync(path, 'utf8').trim();
  return v.length > 0 ? v : null;
}

export function saveEtag(etag: string, path = etagPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${etag}\n`);
  chmodSync(path, 0o600);
}

export interface SelfUpdateOpts {
  cliPath: string;
  fetchFn?: typeof fetch;
  configPath?: string;
  etagPath?: string;
}

// Best-effort. Never throws; returns true iff cli.js was replaced.
export async function maybeSelfUpdate(opts: SelfUpdateOpts): Promise<boolean> {
  try {
    if (process.env.CCUSAGE_CLOUD_NO_SELF_UPDATE) return false;
    if (basename(opts.cliPath) !== 'cli.js') return false;

    const cfg = loadConfig(opts.configPath);
    if (!cfg) return false;

    const fetchFn = opts.fetchFn ?? fetch;
    const eTagFile = opts.etagPath ?? etagPath();
    const stored = loadEtag(eTagFile);

    const headers: Record<string, string> = {};
    if (stored) headers['if-none-match'] = stored;

    // Bound the request so a stalled server can't delay exit after sync has already finished.
    const res = await fetchFn(new URL('/cli.js', cfg.serverUrl), { headers, signal: AbortSignal.timeout(5000) });
    if (res.status === 304) return false;
    if (!res.ok) return false;

    const body = await res.text();
    if (!body.trim()) return false; // never write an empty/blank CLI

    const newEtag = res.headers.get('etag');

    const current = existsSync(opts.cliPath) ? readFileSync(opts.cliPath, 'utf8') : null;
    if (current === body) {
      if (newEtag) saveEtag(newEtag, eTagFile);
      return false;
    }

    const tmp = `${opts.cliPath}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, opts.cliPath); // atomic replace; overwrites on Windows
    if (newEtag) saveEtag(newEtag, eTagFile);
    console.log('Updated CLI to latest.');
    return true;
  } catch {
    return false; // best-effort: never let self-update break sync
  }
}

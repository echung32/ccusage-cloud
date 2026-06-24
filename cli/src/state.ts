import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TaggedSession } from './types';

export interface SyncState {
  hashes: Record<string, string>;
  lastSyncAt: number | null;
}

export function statePath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'ccusage-cloud', 'state.json');
}

export function loadState(path = statePath()): SyncState {
  if (!existsSync(path)) return { hashes: {}, lastSyncAt: null };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SyncState>;
  return { hashes: parsed.hashes ?? {}, lastSyncAt: parsed.lastSyncAt ?? null };
}

export function saveState(state: SyncState, path = statePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  chmodSync(path, 0o600);
}

export function sessionKey(s: TaggedSession): string {
  return `${s.source}\t${s.sessionId}`;
}

// Stable content hash. TaggedSession is built with a deterministic key order
// (valibot output order + sessionId + source), so JSON.stringify is stable.
export function sessionHash(s: TaggedSession): string {
  return createHash('sha256').update(JSON.stringify(s)).digest('hex');
}

export function diffSessions(
  sessions: TaggedSession[],
  state: SyncState,
): { changed: TaggedSession[]; unchanged: number } {
  const changed: TaggedSession[] = [];
  let unchanged = 0;
  for (const s of sessions) {
    if (state.hashes[sessionKey(s)] === sessionHash(s)) unchanged += 1;
    else changed.push(s);
  }
  return { changed, unchanged };
}

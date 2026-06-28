import type { Config } from './config';
import { loadSessions, type Runner } from './ccusage';
import type { TaggedSession } from './types';
import { loadDaily, type DailyRow } from './daily';
import {
  diffSessions,
  loadState,
  saveState,
  sessionHash,
  sessionKey,
  statePath as defaultStatePath,
} from './state';
import { redactProjects } from './redact';

export interface SyncOpts {
  run?: Runner;
  fetchFn?: typeof fetch;
  full?: boolean;
  statePath?: string;
  chunkSize?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(
  url: URL,
  body: unknown,
  token: string,
  fetchFn: typeof fetch,
  retries: number,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let status = 0;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      status = res.status;
      if (status < 500) throw new Error(`request failed: ${status} ${await res.text()}`);
      lastErr = new Error(`request failed: ${status}`);
    } catch (err) {
      if (status > 0 && status < 500) throw err; // re-throw 4xx immediately, no retry
      lastErr = err;
    }
    if (attempt < retries) await sleep(250 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error('request failed');
}

async function postBatch(
  cfg: Config,
  batch: TaggedSession[],
  fetchFn: typeof fetch,
  retries: number,
): Promise<void> {
  await postJson(new URL('/ingest', cfg.serverUrl), { sessions: batch }, cfg.token, fetchFn, retries);
}

export async function syncOnce(
  cfg: Config,
  sources: string[],
  opts: SyncOpts = {},
): Promise<{ pushed: number; skipped: number; chunks: number }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const chunkSize = opts.chunkSize ?? 500;
  const retries = opts.retries ?? 3;
  const path = opts.statePath ?? defaultStatePath();

  const all: TaggedSession[] = [];
  for (const source of sources) all.push(...loadSessions(source, cfg.ccusageBin, opts.run));

  const collected = cfg.redactProjects ? redactProjects(all) : all;

  const state = opts.full ? { hashes: {}, lastSyncAt: null } : loadState(path);
  const { changed, unchanged } = opts.full
    ? { changed: collected, unchanged: 0 }
    : diffSessions(collected, state);

  if (changed.length === 0) {
    saveState({ hashes: state.hashes, lastSyncAt: Date.now() }, path);
    return { pushed: 0, skipped: unchanged, chunks: 0 };
  }

  let pushed = 0;
  let chunks = 0;
  for (let i = 0; i < changed.length; i += chunkSize) {
    const batch = changed.slice(i, i + chunkSize);
    await postBatch(cfg, batch, fetchFn, retries); // throws → state holds prior batches only
    for (const s of batch) state.hashes[sessionKey(s)] = sessionHash(s);
    pushed += batch.length;
    chunks += 1;
    saveState({ hashes: state.hashes, lastSyncAt: Date.now() }, path); // persist after each delivered batch
  }
  return { pushed, skipped: unchanged, chunks };
}

export async function syncDaily(
  cfg: Config,
  sources: string[],
  opts: { run?: Runner; fetchFn?: typeof fetch; chunkSize?: number; retries?: number } = {},
): Promise<{ dailyPushed: number }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const chunkSize = opts.chunkSize ?? 500;
  const retries = opts.retries ?? 3;

  const rows: DailyRow[] = [];
  for (const source of sources) rows.push(...loadDaily(source, cfg.ccusageBin, opts.run));

  let dailyPushed = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = rows.slice(i, i + chunkSize);
    await postJson(new URL('/ingest/daily', cfg.serverUrl), { days: batch }, cfg.token, fetchFn, retries);
    dailyPushed += batch.length;
  }
  return { dailyPushed };
}

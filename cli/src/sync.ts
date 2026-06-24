import type { Config } from './config';
import { loadSessions, type Runner } from './ccusage';
import type { TaggedSession } from './types';

export async function syncOnce(
  cfg: Config,
  sources: string[],
  run?: Runner,
  fetchFn: typeof fetch = fetch,
): Promise<{ pushed: number }> {
  const sessions: TaggedSession[] = [];
  for (const source of sources) {
    sessions.push(...loadSessions(source, cfg.ccusageBin, run));
  }
  if (sessions.length === 0) return { pushed: 0 };

  const res = await fetchFn(new URL('/ingest', cfg.serverUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ sessions }),
  });

  if (!res.ok) {
    throw new Error(`ingest failed: ${res.status} ${await res.text()}`);
  }
  return { pushed: sessions.length };
}

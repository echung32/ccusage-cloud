import { hostname } from 'node:os';
import { saveConfig, type Config } from './config';

export interface EnrollOpts {
  serverUrl: string;
  code: string;
  ccusageBin?: string;
  redactProjects?: boolean;
  label?: string;
  fetchFn?: typeof fetch;
  configPath?: string;
}

export async function enrollDevice(opts: EnrollOpts): Promise<{ token: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const label = opts.label ?? hostname();
  const res = await fetchFn(new URL('/api/enroll', opts.serverUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: opts.code, label }),
  });
  if (res.status === 410) {
    throw new Error('Enrollment link expired or already used. Generate a new one in the dashboard.');
  }
  if (!res.ok) {
    throw new Error(`Enrollment failed: ${res.status} ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  const cfg: Config = {
    serverUrl: opts.serverUrl,
    token,
    ccusageBin: opts.ccusageBin ?? 'ccusage',
    redactProjects: opts.redactProjects ?? false,
  };
  saveConfig(cfg, opts.configPath);
  return { token };
}

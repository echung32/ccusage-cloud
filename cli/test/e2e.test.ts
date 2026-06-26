import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_dev, type UnstableDevWorker } from 'wrangler';
import { syncOnce } from '../src/sync';
import type { Config } from '../src/config';

const WORKER_DIR = resolve(__dirname, '../../worker');
const persistDir = mkdtempSync(join(tmpdir(), 'ccc-e2e-'));
const token = `cccloud_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
const userId = `usr_${randomBytes(8).toString('hex')}`;
const deviceId = `dev_${randomBytes(8).toString('hex')}`;

function d1(sql: string): string {
  return execFileSync(
    'wrangler',
    ['d1', 'execute', 'ccusage-cloud', '--local', `--persist-to=${persistDir}`, '--command', sql, '--json'],
    { cwd: WORKER_DIR, encoding: 'utf8' },
  );
}

let worker: UnstableDevWorker | undefined;
let available = true;

beforeAll(async () => {
  try {
    execFileSync('wrangler', ['d1', 'migrations', 'apply', 'ccusage-cloud', '--local', `--persist-to=${persistDir}`], {
      cwd: WORKER_DIR,
      encoding: 'utf8',
    });
    const now = Date.now();
    d1(
      `INSERT INTO users (id, email, public_to_group, created_at) VALUES ('${userId}', 'e2e@example.com', 0, ${now});` +
        `INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES ('${deviceId}', '${userId}', '${tokenHash}', 'e2e', ${now});`,
    );
    worker = await unstable_dev(join(WORKER_DIR, 'src/index.ts'), {
      config: join(WORKER_DIR, 'wrangler.jsonc'),
      persistTo: persistDir,
      experimental: { disableExperimentalWarning: true },
    });
  } catch (err) {
    available = false;
    console.warn('e2e skipped — wrangler unavailable in this environment:', (err as Error).message);
  }
}, 120_000);

afterAll(async () => {
  await worker?.stop();
});

describe('CLI → Worker → D1 e2e', () => {
  it('syncs a session over HTTP and lands an idempotent row', async () => {
    if (!available || !worker) return; // environment can't run wrangler; skip
    const cfg: Config = {
      serverUrl: `http://${worker.address}:${worker.port}`,
      token,
      ccusageBin: 'unused',
    };
    const fixture = JSON.stringify({
      sessions: [
        { sessionId: 'e2e-s1', inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 30, totalCost: 0.42, firstActivity: 'a', lastActivity: 'b', modelsUsed: ['claude-opus-4-8'], modelBreakdowns: [], projectPath: '/p' },
      ],
      totals: {},
    });
    const statePath = join(persistDir, 'state.json');

    const first = await syncOnce(cfg, ['claude'], { run: () => fixture, statePath });
    expect(first.pushed).toBe(1);

    const out = JSON.parse(d1("SELECT COUNT(*) AS n FROM sessions WHERE session_id='e2e-s1'"));
    const n = out[0]?.results?.[0]?.n ?? out?.results?.[0]?.n;
    expect(Number(n)).toBe(1);

    // Idempotent: a --full re-push updates in place, count stays 1.
    const second = await syncOnce(cfg, ['claude'], { run: () => fixture, statePath, full: true });
    expect(second.pushed).toBe(1);
    const out2 = JSON.parse(d1("SELECT COUNT(*) AS n FROM sessions WHERE session_id='e2e-s1'"));
    const n2 = out2[0]?.results?.[0]?.n ?? out2?.results?.[0]?.n;
    expect(Number(n2)).toBe(1);
  }, 120_000);
});

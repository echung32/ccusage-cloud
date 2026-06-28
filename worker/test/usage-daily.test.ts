import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDevice, seedSession } from './seed';
import { installJwks, mintToken } from './auth-fixture';

beforeAll(() => installJwks());

async function asDevice(token: string, body: unknown) {
  return SELF.fetch('https://example.com/ingest/daily', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('usage_daily migration', () => {
  it('exposes a writable usage_daily table keyed by (user,device,source,day)', async () => {
    await env.DB.prepare(
      'INSERT INTO usage_daily (user_id, device_id, source, day, total_tokens, total_cost, updated_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind('usr_x', 'dev_x', 'claude', '2026-06-01', 100, 0.5, 1000)
      .run();
    const row = await env.DB.prepare(
      'SELECT total_tokens AS t, total_cost AS c FROM usage_daily WHERE user_id=? AND device_id=? AND source=? AND day=?',
    )
      .bind('usr_x', 'dev_x', 'claude', '2026-06-01')
      .first<{ t: number; c: number }>();
    expect(row?.t).toBe(100);
    expect(row?.c).toBe(0.5);
  });
});

describe('POST /ingest/daily', () => {
  it('401s without a device token', async () => {
    const res = await SELF.fetch('https://example.com/ingest/daily', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('upserts rows and updates the same (source,day) in place', async () => {
    const { token, userId, deviceId } = await seedDevice(env);
    const first = await asDevice(token, { days: [{ source: 'opencode', day: '2025-08-29', totalTokens: 100, totalCost: 0.25 }] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ upserted: 1 });

    // re-send same (source,day) with new totals → update, not duplicate
    await asDevice(token, { days: [{ source: 'opencode', day: '2025-08-29', totalTokens: 175, totalCost: 0.4 }] });

    const rows = await env.DB.prepare(
      'SELECT total_tokens AS t, total_cost AS c FROM usage_daily WHERE user_id=? AND device_id=? AND source=? AND day=?',
    ).bind(userId, deviceId, 'opencode', '2025-08-29').all<{ t: number; c: number }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toEqual({ t: 175, c: 0.4 });
  });

  it('400s on an invalid payload', async () => {
    const { token } = await seedDevice(env);
    const res = await asDevice(token, { days: [{ source: 'x', day: '2025-01-01', totalTokens: 'nan', totalCost: 0 }] });
    expect(res.status).toBe(400);
  });
});

async function asViewer(userId: string, path: string) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, { headers: { authorization: `Bearer ${token}` } });
}

async function seedDaily(userId: string, deviceId: string, source: string, day: string, tokens: number, cost: number) {
  await env.DB.prepare(
    'INSERT INTO usage_daily (user_id, device_id, source, day, total_tokens, total_cost, updated_at) VALUES (?,?,?,?,?,?,?)',
  ).bind(userId, deviceId, source, day, tokens, cost, 1).run();
}

describe('summary byDay reads usage_daily', () => {
  it('includes dateless-session sources via usage_daily and honors from/to + source filters', async () => {
    const { userId, deviceId } = await seedDevice(env);
    // a session with NO dates (the opencode case) — must NOT drive the timeline
    await seedSession(env, { userId, deviceId, source: 'opencode', lastActivity: null });
    // usage_daily rows that SHOULD drive the timeline
    await seedDaily(userId, deviceId, 'opencode', '2025-08-29', 500, 1.0);
    await seedDaily(userId, deviceId, 'claude', '2026-06-10', 200, 0.5);

    const res = await asViewer(userId, '/api/summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { byDay: { day: string; totalTokens: number }[]; byDaySource: { day: string; source: string }[] };
    const days = body.byDay.map((d) => d.day).sort();
    expect(days).toContain('2025-08-29'); // opencode history now visible
    expect(days).toContain('2026-06-10');
    expect(body.byDaySource.some((r) => r.source === 'opencode' && r.day === '2025-08-29')).toBe(true);

    // from filter clips the early day
    const clipped = await asViewer(userId, '/api/summary?from=2026-01-01T00:00:00.000Z');
    const clippedDays = ((await clipped.json()) as { byDay: { day: string }[] }).byDay.map((d) => d.day);
    expect(clippedDays).not.toContain('2025-08-29');
    expect(clippedDays).toContain('2026-06-10');

    // source filter narrows to claude
    const claudeOnly = await asViewer(userId, '/api/summary?source=claude');
    const coDays = ((await claudeOnly.json()) as { byDay: { day: string }[] }).byDay.map((d) => d.day);
    expect(coDays).toEqual(['2026-06-10']);
  });
});

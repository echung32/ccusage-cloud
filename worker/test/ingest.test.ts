import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedDevice } from './seed';

function session(overrides: Record<string, unknown> = {}) {
  return {
    source: 'claude',
    sessionId: 's1',
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 30,
    totalCost: 0.5,
    firstActivity: '2026-06-01T00:00:00Z',
    lastActivity: '2026-06-01T01:00:00Z',
    modelsUsed: ['claude-opus-4-8'],
    modelBreakdowns: [{ model: 'claude-opus-4-8', cost: 0.5 }],
    projectPath: '/home/me/proj',
    ...overrides,
  };
}

async function post(token: string, sessions: unknown[]) {
  return SELF.fetch('https://example.com/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessions }),
  });
}

describe('POST /ingest', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed payload', async () => {
    const { token } = await seedDevice(env);
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessions: [{ sessionId: 's1' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('inserts a session row scoped to the device user', async () => {
    const { token, userId, deviceId } = await seedDevice(env);
    const res = await post(token, [session()]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 1, skipped: 0 });

    const row = await env.DB.prepare(
      'SELECT total_cost FROM sessions WHERE user_id=? AND device_id=? AND source=? AND session_id=?',
    )
      .bind(userId, deviceId, 'claude', 's1')
      .first<{ total_cost: number }>();
    expect(row?.total_cost).toBe(0.5);
  });

  it('is idempotent: re-pushing updates, does not duplicate', async () => {
    const { token, userId, deviceId } = await seedDevice(env);
    await post(token, [session({ totalCost: 0.5 })]);
    await post(token, [session({ totalCost: 1.25 })]);

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND device_id=? AND source=? AND session_id=?',
    )
      .bind(userId, deviceId, 'claude', 's1')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const row = await env.DB.prepare(
      'SELECT total_cost FROM sessions WHERE user_id=? AND device_id=? AND source=? AND session_id=?',
    )
      .bind(userId, deviceId, 'claude', 's1')
      .first<{ total_cost: number }>();
    expect(row?.total_cost).toBe(1.25);
  });

  it('updates the device last_seen_at', async () => {
    const { token, deviceId } = await seedDevice(env);
    await post(token, [session()]);
    const row = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id=?')
      .bind(deviceId)
      .first<{ last_seen_at: number | null }>();
    expect(row?.last_seen_at).not.toBeNull();
  });
});

describe('POST /ingest dedup grain', () => {
  it('stores same sessionId under different projectPaths as separate rows', async () => {
    const { token, userId } = await seedDevice(env);
    const a = session({ sessionId: 'dup1', projectPath: '/repo', totalTokens: 100, totalCost: 1 });
    const b = session({ sessionId: 'dup1', projectPath: '/repo/.worktree', totalTokens: 40, totalCost: 0.4 });
    const res = await post(token, [a, b]);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(total_tokens),0) AS tok, COALESCE(SUM(total_cost),0) AS cost FROM sessions WHERE user_id = ? AND session_id = ?',
    ).bind(userId, 'dup1').first<{ n: number; tok: number; cost: number }>();
    expect(row?.n).toBe(2);
    expect(row?.tok).toBe(140);
    expect(row?.cost).toBeCloseTo(1.4);
  });

  it('is idempotent: re-posting updates in place, no new rows', async () => {
    const { token, userId } = await seedDevice(env);
    const a = session({ sessionId: 'dup2', projectPath: '/repo', totalTokens: 100 });
    const b = session({ sessionId: 'dup2', projectPath: '/repo/.worktree', totalTokens: 40 });
    await post(token, [a, b]);
    await post(token, [{ ...a, totalTokens: 111 }, b]);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(total_tokens),0) AS tok FROM sessions WHERE user_id = ? AND session_id = ?',
    ).bind(userId, 'dup2').first<{ n: number; tok: number }>();
    expect(row?.n).toBe(2);
    expect(row?.tok).toBe(151);
  });

  it('normalizes a null projectPath to empty string', async () => {
    const { token, userId } = await seedDevice(env);
    await post(token, [session({ sessionId: 'np1', projectPath: null })]);
    const row = await env.DB.prepare(
      'SELECT project_path AS p FROM sessions WHERE user_id = ? AND session_id = ?',
    ).bind(userId, 'np1').first<{ p: string }>();
    expect(row?.p).toBe('');
  });
});

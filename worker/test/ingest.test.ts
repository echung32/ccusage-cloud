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
    const { token, userId } = await seedDevice(env);
    await post(token, [session({ totalCost: 0.5 })]);
    await post(token, [session({ totalCost: 1.25 })]);

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND session_id=?',
    )
      .bind(userId, 's1')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const row = await env.DB.prepare(
      'SELECT total_cost FROM sessions WHERE user_id=? AND session_id=?',
    )
      .bind(userId, 's1')
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

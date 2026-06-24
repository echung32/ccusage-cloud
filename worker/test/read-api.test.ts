import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { putViewerSession } from '../src/kv';
import { seedUser, seedDevice, seedSession } from './seed';

async function asViewer(userId: string, path: string, init: RequestInit = {}) {
  const sid = `sid_${userId}`;
  await putViewerSession(env, sid, userId);
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `ccusage_session=${sid}` },
  });
}

describe('GET /api/summary', () => {
  it('401s unauthenticated', async () => {
    expect((await SELF.fetch('https://example.com/api/summary')).status).toBe(401);
  });

  it('returns the summary shape for the viewer', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `s-${userId}@example.com`, 'laptop');
    await seedSession(env, { userId, deviceId, source: 'claude', totalTokens: 100, totalCost: 1, lastActivity: '2026-06-20T10:00:00.000Z' });
    const res = await asViewer(userId, '/api/summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totals: { sessions: number; totalTokens: number }; byDay: unknown[]; bySource: unknown[]; byModel: unknown[]; byProject: unknown[]; byDevice: unknown[] };
    expect(body.totals.sessions).toBe(1);
    expect(body.totals.totalTokens).toBe(100);
    expect(Array.isArray(body.byDay)).toBe(true);
    expect(Array.isArray(body.bySource)).toBe(true);
    expect(Array.isArray(body.byModel)).toBe(true);
    expect(Array.isArray(body.byProject)).toBe(true);
    expect(Array.isArray(body.byDevice)).toBe(true);
  });

  it('passes filters through', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `f-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, source: 'claude', totalTokens: 10, lastActivity: '2026-06-20T00:00:00.000Z' });
    await seedSession(env, { userId, deviceId, source: 'codex', totalTokens: 20, lastActivity: '2026-06-21T00:00:00.000Z' });
    const res = await asViewer(userId, '/api/summary?source=codex');
    const body = (await res.json()) as { totals: { sessions: number } };
    expect(body.totals.sessions).toBe(1);
  });

  it('isolates users', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `i-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, totalTokens: 5, lastActivity: '2026-06-20T00:00:00.000Z' });
    const { userId: other } = await seedUser(env);
    const { deviceId: od } = await seedDevice(env, `i2-${other}@example.com`);
    await seedSession(env, { userId: other, deviceId: od, totalTokens: 9999, lastActivity: '2026-06-20T00:00:00.000Z' });
    const res = await asViewer(userId, '/api/summary');
    const body = (await res.json()) as { totals: { totalTokens: number } };
    expect(body.totals.totalTokens).toBe(5);
  });
});

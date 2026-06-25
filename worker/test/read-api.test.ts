import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, mintToken } from './auth-fixture';
import { seedUser, seedDevice, seedSession } from './seed';

beforeAll(() => installJwks());

async function asViewer(userId: string, path: string, init: RequestInit = {}) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
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

describe('GET /api/sessions', () => {
  it('401s unauthenticated', async () => {
    expect((await SELF.fetch('https://example.com/api/sessions')).status).toBe(401);
  });

  it('returns a first page + nextCursor and a second page', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `sp-${userId}@example.com`);
    for (let i = 0; i < 3; i++) {
      const day = String(10 + i).padStart(2, '0');
      await seedSession(env, { userId, deviceId, sessionId: `q${i}`, totalTokens: i, lastActivity: `2026-06-${day}T00:00:00.000Z` });
    }
    const res = await asViewer(userId, '/api/sessions?limit=2');
    const body = (await res.json()) as { sessions: { sessionId: string }[]; nextCursor: string | null };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0]!.sessionId).toBe('q2');
    expect(body.nextCursor).not.toBeNull();
    const res2 = await asViewer(userId, `/api/sessions?limit=2&cursor=${encodeURIComponent(body.nextCursor!)}`);
    const body2 = (await res2.json()) as { sessions: { sessionId: string }[]; nextCursor: string | null };
    expect(body2.sessions[0]!.sessionId).toBe('q0');
    expect(body2.nextCursor).toBeNull();
  });

  it('isolates users', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `sp2-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, sessionId: 'mine', lastActivity: '2026-06-20T00:00:00.000Z' });
    const { userId: other } = await seedUser(env);
    const { deviceId: od } = await seedDevice(env, `sp3-${other}@example.com`);
    await seedSession(env, { userId: other, deviceId: od, sessionId: 'theirs', lastActivity: '2026-07-01T00:00:00.000Z' });
    const res = await asViewer(userId, '/api/sessions');
    const body = (await res.json()) as { sessions: { sessionId: string }[] };
    expect(body.sessions.some((s) => s.sessionId === 'theirs')).toBe(false);
  });
});

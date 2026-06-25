import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, mintToken } from './auth-fixture';
import { seedUser, seedDevice, seedSession } from './seed';

beforeAll(() => installJwks());

async function asViewer(userId: string, path: string) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, { headers: { authorization: `Bearer ${token}` } });
}

describe('GET /api/summary?scope=group', () => {
  it('returns overall-only group aggregate (no project), excludes opted-out', async () => {
    const { userId: a } = await seedUser(env);
    await env.DB.prepare('UPDATE users SET public_to_group = 1 WHERE id = ?').bind(a).run();
    const { deviceId: da } = await seedDevice(env, `ga-${a}@example.com`);
    await seedSession(env, { userId: a, deviceId: da, totalTokens: 100, totalCost: 1, projectPath: '/secret', lastActivity: '2026-06-20T00:00:00.000Z' });
    const { userId: b } = await seedUser(env); // opted out
    const { deviceId: dbid } = await seedDevice(env, `gb-${b}@example.com`);
    await seedSession(env, { userId: b, deviceId: dbid, totalTokens: 9999, lastActivity: '2026-06-20T00:00:00.000Z' });
    // viewer b (opted out) can still read the group overall view
    const res = await asViewer(b, '/api/summary?scope=group');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totals: { totalTokens: number }; byProject: unknown[] };
    expect(body.totals.totalTokens).toBe(100);
    expect(body.byProject).toEqual([]);
  });

  it('scope=me (default) is unchanged and never leaks others', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `me-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, totalTokens: 7, projectPath: '/mine', lastActivity: '2026-06-20T00:00:00.000Z' });
    const res = await asViewer(userId, '/api/summary');
    const body = (await res.json()) as { totals: { totalTokens: number }; byProject: { projectPath: string }[] };
    expect(body.totals.totalTokens).toBe(7);
    expect(body.byProject.some((p) => p.projectPath === '/mine')).toBe(true);
  });

  it('sessions ignores scope=group and stays me-only', async () => {
    const { userId: a } = await seedUser(env);
    await env.DB.prepare('UPDATE users SET public_to_group = 1 WHERE id = ?').bind(a).run();
    const { deviceId: da } = await seedDevice(env, `sa-${a}@example.com`);
    await seedSession(env, { userId: a, deviceId: da, sessionId: 'A', lastActivity: '2026-06-20T00:00:00.000Z' });
    const { userId: b } = await seedUser(env);
    await env.DB.prepare('UPDATE users SET public_to_group = 1 WHERE id = ?').bind(b).run();
    const { deviceId: dbid } = await seedDevice(env, `sb-${b}@example.com`);
    await seedSession(env, { userId: b, deviceId: dbid, sessionId: 'B', lastActivity: '2026-06-21T00:00:00.000Z' });
    const res = await asViewer(a, '/api/sessions?scope=group');
    const body = (await res.json()) as { sessions: { sessionId: string }[] };
    expect(body.sessions.some((s) => s.sessionId === 'B')).toBe(false); // never another user's sessions
  });
});

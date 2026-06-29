import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, mintToken } from './auth-fixture';
import { seedUser } from './seed';
import { READ_RATE_LIMIT, READ_RATE_WINDOW } from '../src/viewer_ratelimit';

beforeAll(() => installJwks());

async function asViewer(userId: string, path: string) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, { headers: { authorization: `Bearer ${token}` } });
}

describe('read API rate limiting', () => {
  it('allows requests under the limit', async () => {
    const { userId } = await seedUser(env);
    expect((await asViewer(userId, '/api/me')).status).toBe(200);
    expect((await asViewer(userId, '/api/me')).status).toBe(200);
  });

  it('429s once the per-user window budget is spent', async () => {
    const { userId } = await seedUser(env);
    const bucket = Math.floor(Math.floor(Date.now() / 1000) / READ_RATE_WINDOW);
    await env.RATE_LIMITS.put(`rl:viewer:${userId}:${bucket}`, String(READ_RATE_LIMIT), {
      expirationTtl: READ_RATE_WINDOW + 60,
    });
    const res = await asViewer(userId, '/api/me');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate limited' });
  });

  it('counts a read endpoint once even though two routers match /api/*', async () => {
    // /api/summary is served by readApiRoutes but apiRoutes also has /api/* middleware.
    // Pre-seed the bucket to limit-1; a single request must tip it to the limit, not over.
    const { userId } = await seedUser(env);
    const bucket = Math.floor(Math.floor(Date.now() / 1000) / READ_RATE_WINDOW);
    const key = `rl:viewer:${userId}:${bucket}`;
    await env.RATE_LIMITS.put(key, String(READ_RATE_LIMIT - 1), { expirationTtl: READ_RATE_WINDOW + 60 });
    expect((await asViewer(userId, '/api/summary')).status).toBe(200);
    expect(Number(await env.RATE_LIMITS.get(key))).toBe(READ_RATE_LIMIT); // +1, not +2
  });
});

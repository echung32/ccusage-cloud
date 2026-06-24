import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { putViewerSession } from '../src/kv';
import { seedUser } from './seed';

async function asViewer(userId: string, path: string, init: RequestInit = {}) {
  const sid = `sid_${userId}`;
  await putViewerSession(env, sid, userId);
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `ccusage_session=${sid}` },
  });
}

describe('GET /api/me', () => {
  it('401s unauthenticated', async () => {
    expect((await SELF.fetch('https://example.com/api/me')).status).toBe(401);
  });

  it('returns the viewer profile and devices', async () => {
    const { userId, email } = await seedUser(env);
    const res = await asViewer(userId, '/api/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; email: string; publicToGroup: boolean; devices: unknown[] };
    expect(body.id).toBe(userId);
    expect(body.email).toBe(email);
    expect(body.publicToGroup).toBe(false);
    expect(Array.isArray(body.devices)).toBe(true);
  });
});

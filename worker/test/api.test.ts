import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { putViewerSession } from '../src/kv';
import { seedUser } from './seed';
import { sha256Hex } from '../src/crypto';

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

describe('device management', () => {
  it('mints a device token scoped to the viewer and stores only its hash', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'laptop' }),
    });
    expect(res.status).toBe(200);
    const { id, token } = (await res.json()) as { id: string; token: string };
    expect(token.startsWith('cccloud_')).toBe(true);

    const row = await env.DB.prepare('SELECT user_id, token_sha256 FROM devices WHERE id = ?')
      .bind(id)
      .first<{ user_id: string; token_sha256: string }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.token_sha256).toBe(await sha256Hex(token));
  });

  it('rejects an empty label', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('revokes a device the viewer owns, 404 for one they do not', async () => {
    const { userId } = await seedUser(env);
    const minted = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'phone' }),
    });
    const { id } = (await minted.json()) as { id: string };

    const del = await asViewer(userId, `/api/devices/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const row = await env.DB.prepare('SELECT revoked_at FROM devices WHERE id = ?').bind(id).first<{ revoked_at: number | null }>();
    expect(row?.revoked_at).not.toBeNull();

    const { userId: other } = await seedUser(env);
    const del2 = await asViewer(other, `/api/devices/${id}`, { method: 'DELETE' });
    expect(del2.status).toBe(404);
  });
});

import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, mintToken } from './auth-fixture';
import { seedUser } from './seed';
import { sha256Hex } from '../src/crypto';

beforeAll(() => installJwks());

async function asViewer(userId: string, path: string, init: RequestInit = {}) {
  const token = await mintToken({ sub: userId });
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
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

describe('PATCH /api/me', () => {
  it('toggles group sharing', async () => {
    const { userId } = await seedUser(env);
    const on = await asViewer(userId, '/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicToGroup: true }),
    });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ publicToGroup: true });
    const row = await env.DB.prepare('SELECT public_to_group FROM users WHERE id = ?').bind(userId).first<{ public_to_group: number }>();
    expect(row?.public_to_group).toBe(1);
  });

  it('rejects a non-boolean', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicToGroup: 'yes' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/devices/:id (rename)', () => {
  async function mint(userId: string, label: string): Promise<string> {
    const res = await asViewer(userId, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  it('renames a device the viewer owns', async () => {
    const { userId } = await seedUser(env);
    const id = await mint(userId, 'old-name');
    const res = await asViewer(userId, `/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'new-name' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await env.DB.prepare('SELECT label FROM devices WHERE id = ?').bind(id).first<{ label: string }>();
    expect(row?.label).toBe('new-name');
  });

  it('404s renaming a device the viewer does not own', async () => {
    const { userId } = await seedUser(env);
    const id = await mint(userId, 'mine');
    const { userId: other } = await seedUser(env);
    const res = await asViewer(other, `/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'hijack' }),
    });
    expect(res.status).toBe(404);
  });

  it('404s an unknown device id', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/devices/dev_does_not_exist', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'whatever' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an empty label', async () => {
    const { userId } = await seedUser(env);
    const id = await mint(userId, 'real');
    const res = await asViewer(userId, `/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '' }),
    });
    expect(res.status).toBe(400);
  });
});

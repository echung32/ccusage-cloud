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

describe('enroll_codes migration', () => {
  it('exposes a writable enroll_codes table', async () => {
    const { userId } = await seedUser(env);
    await env.DB.prepare(
      'INSERT INTO enroll_codes (code_sha256, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
      .bind('hash_abc', userId, 1000, 2000)
      .run();
    const row = await env.DB.prepare('SELECT user_id, used_at FROM enroll_codes WHERE code_sha256 = ?')
      .bind('hash_abc')
      .first<{ user_id: string; used_at: number | null }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.used_at).toBeNull();
  });
});

describe('POST /api/enroll-codes', () => {
  it('401s unauthenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/enroll-codes', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('mints a code for the viewer and stores only its hash', async () => {
    const { userId } = await seedUser(env);
    const res = await asViewer(userId, '/api/enroll-codes', { method: 'POST' });
    expect(res.status).toBe(200);
    const { code, expiresAt } = (await res.json()) as { code: string; expiresAt: number };
    expect(code.startsWith('ec_')).toBe(true);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const row = await env.DB.prepare('SELECT user_id, code_sha256, used_at FROM enroll_codes WHERE code_sha256 = ?')
      .bind(await sha256Hex(code))
      .first<{ user_id: string; code_sha256: string; used_at: number | null }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.used_at).toBeNull();
  });
});

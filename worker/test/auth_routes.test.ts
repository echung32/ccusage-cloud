import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { putLoginToken } from '../src/kv';
import { seedUser } from './seed';

async function request(email: unknown) {
  return SELF.fetch('https://example.com/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

describe('POST /auth/request', () => {
  it('mints a login token for an allow-listed email and returns 200', async () => {
    const { email } = await seedUser(env);
    const res = await request(email);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { keys } = await env.LOGIN_TOKENS.list();
    expect(keys.length).toBeGreaterThan(0);
  });

  it('returns 200 without minting for a non-allow-listed email', async () => {
    const before = (await env.LOGIN_TOKENS.list()).keys.length;
    const res = await request('stranger@nowhere.test');
    expect(res.status).toBe(200);
    expect((await env.LOGIN_TOKENS.list()).keys.length).toBe(before);
  });

  it('returns 200 on malformed input', async () => {
    const res = await request(12345);
    expect(res.status).toBe(200);
  });
});

describe('GET /auth/callback + logout', () => {
  it('consumes a token, sets a session cookie, redirects, and is single-use', async () => {
    await putLoginToken(env, 'logintok', 'cb@example.com');
    const res = await SELF.fetch('https://example.com/auth/callback?token=logintok', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('ccusage_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    // Token is single-use: a replay fails.
    const replay = await SELF.fetch('https://example.com/auth/callback?token=logintok', { redirect: 'manual' });
    expect(replay.status).toBe(401);

    // A user row was provisioned for the email.
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('cb@example.com').first();
    expect(user).not.toBeNull();
  });

  it('rejects a missing/invalid token', async () => {
    expect((await SELF.fetch('https://example.com/auth/callback', { redirect: 'manual' })).status).toBe(401);
    expect((await SELF.fetch('https://example.com/auth/callback?token=nope', { redirect: 'manual' })).status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const res = await SELF.fetch('https://example.com/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toContain('ccusage_session=');
  });
});

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

async function postCallback(body: string) {
  return SELF.fetch('https://example.com/auth/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
}

describe('GET /auth/callback (confirm page) + POST (sign in) + logout', () => {
  it('GET does not consume the token; POST consumes it, sets the cookie, redirects, single-use', async () => {
    await putLoginToken(env, 'logintok', 'cb@example.com');

    // A bare GET (what crawlers/scanners do) must render a confirm page and NOT
    // burn the single-use token.
    const get = await SELF.fetch('https://example.com/auth/callback?token=logintok', { redirect: 'manual' });
    expect(get.status).toBe(200);
    const html = await get.text();
    expect(html).toContain('method="POST"');
    expect(html).toContain('action="/auth/callback"');
    expect(html).toContain('logintok');
    expect(await env.LOGIN_TOKENS.get('logintok')).not.toBeNull(); // still valid

    // POST completes sign-in.
    const res = await postCallback('token=logintok');
    expect(res.status).toBe(302);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('ccusage_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    // Token is single-use: a replay POST fails.
    expect((await postCallback('token=logintok')).status).toBe(401);

    // A user row was provisioned for the email.
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('cb@example.com').first();
    expect(user).not.toBeNull();
  });

  it('GET without a token 401s; POST with missing/invalid token 401s', async () => {
    expect((await SELF.fetch('https://example.com/auth/callback', { redirect: 'manual' })).status).toBe(401);
    expect((await postCallback('')).status).toBe(401);
    expect((await postCallback('token=nope')).status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const res = await SELF.fetch('https://example.com/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toContain('ccusage_session=');
  });
});

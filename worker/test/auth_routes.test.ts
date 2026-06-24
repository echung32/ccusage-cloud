import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
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

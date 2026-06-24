import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedDevice } from './seed';

describe('deviceAuth', () => {
  it('rejects a request with no token', async () => {
    const res = await SELF.fetch('https://example.com/_whoami');
    expect(res.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const res = await SELF.fetch('https://example.com/_whoami', {
      headers: { Authorization: 'Bearer cccloud_nope' },
    });
    expect(res.status).toBe(401);
  });

  it('resolves a seeded device to its user', async () => {
    const { token, userId, deviceId } = await seedDevice(env);
    const res = await SELF.fetch('https://example.com/_whoami', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId, deviceId });
  });
});

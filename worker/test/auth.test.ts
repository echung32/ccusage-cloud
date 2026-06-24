import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedDevice } from './seed';

describe('deviceAuth', () => {
  it('rejects a request with no token', async () => {
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer cccloud_nope' },
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('resolves a seeded device to its user', async () => {
    const { token } = await seedDevice(env);
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(200);
  });
});

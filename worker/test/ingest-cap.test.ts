import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedDevice } from './seed';

describe('/ingest payload cap', () => {
  it('rejects an oversized batch with 400', async () => {
    const { token } = await seedDevice(env);
    const sessions = Array.from({ length: 1001 }, (_, i) => ({
      source: 'claude',
      sessionId: `s${i}`,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      modelsUsed: [],
      firstActivity: null,
      lastActivity: '2026-06-20T00:00:00.000Z',
      projectPath: null,
    }));
    const res = await SELF.fetch('https://example.com/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessions }),
    });
    expect(res.status).toBe(400);
  });
});

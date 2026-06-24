import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { putViewerSession } from '../src/kv';
import { seedUser } from './seed';

describe('requireViewer', () => {
  it('401s without a session cookie', async () => {
    const res = await SELF.fetch('https://example.com/api/me');
    expect(res.status).toBe(401);
  });

  it('resolves a valid session cookie to the user', async () => {
    const { userId } = await seedUser(env);
    await putViewerSession(env, 'sidA', userId);
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { cookie: 'ccusage_session=sidA' },
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { id: string }).id).toBe(userId);
  });

  it('401s for an unknown session id', async () => {
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { cookie: 'ccusage_session=ghost' },
    });
    expect(res.status).toBe(401);
  });
});

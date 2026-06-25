import { SELF, fetchMock } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { mintToken } from './auth-fixture';

describe('requireUser when the JWKS endpoint fails', () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock
      .get('https://auth.ethanchung.dev')
      .intercept({ path: '/.well-known/jwks.json' })
      .reply(500, 'boom')
      .persist();
  });

  it('does not authenticate (503 preferred; 401 acceptable)', async () => {
    const token = await mintToken({ sub: 'gh|err' });
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    // 503 = our middleware caught a non-Response error (gateway/JWKS down).
    // 401 = auth-verify wrapped the JWKS failure as a Response. Either keeps the
    // user out; the dashboard's returned=1 guard prevents a redirect loop.
    expect([401, 503]).toContain(res.status);
  });
});

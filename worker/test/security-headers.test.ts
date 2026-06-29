import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('security headers', () => {
  it('sets hardening headers on responses', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  });
});

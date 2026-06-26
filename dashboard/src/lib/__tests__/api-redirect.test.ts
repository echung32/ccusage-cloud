import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMe } from '@/lib/api';

afterEach(() => vi.restoreAllMocks());

describe('api 401 handling', () => {
  it('redirects to the gateway authorize URL on 401', async () => {
    const loc = { href: 'https://ccusage.ethanchung.dev/overview' };
    vi.stubGlobal('location', loc as unknown as Location);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    // getMe never resolves on 401 (it redirects); race it against a tick.
    await Promise.race([getMe().catch(() => {}), new Promise((r) => setTimeout(r, 10))]);

    expect(loc.href).toContain('https://auth.ethanchung.dev/authorize');
    expect(loc.href).toContain('redirect_uri=');
    // returned=1 is inside the URL-encoded redirect_uri, so check the decoded form
    expect(decodeURIComponent(loc.href)).toContain('returned=1');
  });
});

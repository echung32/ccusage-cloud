import { SELF, env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

describe('ASSETS fallthrough', () => {
  it('delegates unknown non-API paths to the ASSETS binding', async () => {
    const spy = vi.spyOn(env.ASSETS, 'fetch').mockImplementation(() => Promise.resolve(new Response('STATIC_INDEX', { status: 200 })));
    const res = await SELF.fetch('https://example.com/some/spa/route');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('STATIC_INDEX');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still routes /health to the worker, not assets', async () => {
    const spy = vi.spyOn(env.ASSETS, 'fetch').mockResolvedValue(new Response('STATIC', { status: 200 }));
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still 401s /api/* (API wins over assets)', async () => {
    const spy = vi.spyOn(env.ASSETS, 'fetch').mockResolvedValue(new Response('STATIC', { status: 200 }));
    const res = await SELF.fetch('https://example.com/api/me');
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

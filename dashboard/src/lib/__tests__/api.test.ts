import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMe, getSummary, getSessions, createDevice, deleteDevice, patchMe, logout } from '../api';

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('api client', () => {
  it('getMe GETs /api/me with credentials', async () => {
    const f = mockFetch({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] });
    vi.stubGlobal('fetch', f);
    const me = await getMe();
    expect(me.id).toBe('u1');
    expect(f).toHaveBeenCalledWith('/api/me', expect.objectContaining({ credentials: 'include' }));
  });

  it('getSummary serializes filters into the query string', async () => {
    const f = mockFetch({ totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 }, byDay: [], bySource: [], byModel: [], byProject: [], byDevice: [] });
    vi.stubGlobal('fetch', f);
    await getSummary({ source: 'claude', from: '2026-06-01' });
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain('/api/summary?');
    expect(url).toContain('source=claude');
    expect(url).toContain('from=2026-06-01');
  });

  it('getSessions appends the cursor', async () => {
    const f = mockFetch({ sessions: [], nextCursor: null });
    vi.stubGlobal('fetch', f);
    await getSessions({}, 'CUR');
    expect(f.mock.calls[0][0]).toContain('cursor=CUR');
  });

  it('createDevice POSTs the label', async () => {
    const f = mockFetch({ id: 'dev1', token: 'cccloud_x' });
    vi.stubGlobal('fetch', f);
    const r = await createDevice('laptop');
    expect(r.token).toBe('cccloud_x');
    expect(f).toHaveBeenCalledWith('/api/devices', expect.objectContaining({ method: 'POST' }));
  });

  it('deleteDevice DELETEs by id', async () => {
    const f = mockFetch({ ok: true });
    vi.stubGlobal('fetch', f);
    await deleteDevice('dev1');
    expect(f).toHaveBeenCalledWith('/api/devices/dev1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('patchMe PATCHes publicToGroup', async () => {
    const f = mockFetch({ publicToGroup: true });
    vi.stubGlobal('fetch', f);
    const r = await patchMe(true);
    expect(r.publicToGroup).toBe(true);
  });

  it('logout POSTs to the gateway /logout with credentials', async () => {
    const f = mockFetch({});
    vi.stubGlobal('fetch', f);
    await logout();
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining('/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain('https://auth.ethanchung.dev');
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' } as unknown as Location);
    vi.stubGlobal('fetch', mockFetch({ error: 'nope' }, 401));
    await expect(getMe()).rejects.toThrow();
  });

  it('getSummary serializes scope=group', async () => {
    const f = mockFetch({ totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 }, byDay: [], bySource: [], byModel: [], byProject: [], byDevice: [] });
    vi.stubGlobal('fetch', f);
    await getSummary({ scope: 'group' });
    expect(f.mock.calls[0][0]).toContain('scope=group');
  });
});

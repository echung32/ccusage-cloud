import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../src/components/Overview';
import { LoginGate } from '../src/components/LoginGate';

const canRun = typeof document !== 'undefined' && process.env.CI_SKIP_E2E !== '1';

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!canRun)('e2e: login -> overview', () => {
  it('an authenticated viewer is redirected and overview shows totals', async () => {
    const okMe = { id: 'gh|u1', email: null, publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] };
    const loc = { href: 'https://ccusage.ethanchung.dev/' } as unknown as Location;
    vi.stubGlobal('location', loc);
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify(okMe), { status: 200 }));
      if (url.startsWith('/api/summary')) {
        return Promise.resolve(new Response(JSON.stringify({
          totals: { sessions: 7, totalTokens: 1000, inputTokens: 700, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 9.99 },
          byDay: [{ day: '2026-06-21', totalTokens: 1000, totalCost: 9.99 }],
          bySource: [], byModel: [], byProject: [], byDevice: [],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));

    const gate = render(<LoginGate />);
    await waitFor(() => expect(loc.href).toContain('/overview'));
    gate.unmount();

    render(<Overview />);
    await waitFor(() => expect(screen.getByText('1,000')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/\$9\.99/)).toBeInTheDocument();
  });
});

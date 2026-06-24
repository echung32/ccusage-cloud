import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../Overview';

afterEach(() => vi.restoreAllMocks());

function routeFetch(map: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(map).find((k) => url.startsWith(k));
    const body = key ? map[key] : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
}

describe('Overview', () => {
  it('renders headline totals from the summary', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/me': { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] },
      '/api/summary': {
        totals: { sessions: 3, totalTokens: 465, inputTokens: 310, outputTokens: 155, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 3.5 },
        byDay: [{ day: '2026-06-20', totalTokens: 150, totalCost: 1 }, { day: '2026-06-21', totalTokens: 315, totalCost: 2.5 }],
        bySource: [], byModel: [], byProject: [], byDevice: [],
      },
    }));
    render(<Overview />);
    await waitFor(() => expect(screen.getByText('465')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/\$3\.50/)).toBeInTheDocument();
  });
});

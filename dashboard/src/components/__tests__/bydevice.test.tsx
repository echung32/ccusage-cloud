import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ByDevice } from '../ByDevice';

afterEach(() => vi.restoreAllMocks());

describe('ByDevice', () => {
  it('renders the device contribution legend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const body = url.startsWith('/api/me')
        ? { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }
        : {
            totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
            byDay: [], bySource: [], byModel: [], byProject: [],
            byDevice: [{ deviceId: 'd1', label: 'laptop', totalTokens: 450, totalCost: 3, sessions: 2 }, { deviceId: 'd2', label: 'desktop', totalTokens: 15, totalCost: 0.5, sessions: 1 }],
          };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }));
    render(<ByDevice />);
    await waitFor(() => expect(screen.getByText(/laptop/)).toBeInTheDocument());
    expect(screen.getByText(/desktop/)).toBeInTheDocument();
  });
});

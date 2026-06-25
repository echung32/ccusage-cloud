import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ByDevice } from '../ByDevice';

afterEach(() => vi.restoreAllMocks());

describe('ByDevice', () => {
  it('renders device rows from the summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
        byDay: [], bySource: [], byModel: [], byProject: [], byDevice: [{ deviceId: 'd1', label: 'work-laptop', totalTokens: 90, totalCost: 0.7, sessions: 3 }],
      }), { status: 200 }));
    }));
    render(<ByDevice />);
    await waitFor(() => expect(screen.getAllByText('work-laptop').length).toBeGreaterThan(0));
    // Cloudscape PieChart renders an <svg aria-label="..."> — assert chart is present, not just the table.
    expect(screen.getByLabelText('Device contribution by cost')).toBeInTheDocument();
  });
});

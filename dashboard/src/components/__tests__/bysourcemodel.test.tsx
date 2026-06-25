import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BySourceModel } from '../BySourceModel';

afterEach(() => vi.restoreAllMocks());

describe('BySourceModel', () => {
  it('renders source and model rows from the summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
        byDay: [], bySource: [{ source: 'claude-code', totalTokens: 100, totalCost: 1.2, sessions: 2 }],
        byModel: [{ model: 'claude-opus-4-8', totalTokens: 80, totalCost: 1.0 }], byProject: [], byDevice: [],
      }), { status: 200 }));
    }));
    render(<BySourceModel />);
    // Cloudscape BarChart renders the data key as aria-label on SVG elements AND the Table renders
    // it as cell text — use getAllByText since multiple DOM nodes contain the value.
    await waitFor(() => expect(screen.getAllByText('claude-code').length).toBeGreaterThan(0));
    expect(screen.getAllByText('claude-opus-4-8').length).toBeGreaterThan(0);
  });
});

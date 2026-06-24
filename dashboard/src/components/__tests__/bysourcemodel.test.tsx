import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BySourceModel } from '../BySourceModel';

afterEach(() => vi.restoreAllMocks());

describe('BySourceModel', () => {
  it('lists sources and models from the summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const body = url.startsWith('/api/me')
        ? { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }
        : {
            totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
            byDay: [],
            bySource: [{ source: 'claude', totalTokens: 450, totalCost: 3, sessions: 2 }, { source: 'codex', totalTokens: 15, totalCost: 0.5, sessions: 1 }],
            byModel: [{ model: 'claude-opus-4', totalTokens: 150, totalCost: 1 }],
            byProject: [], byDevice: [],
          };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }));
    render(<BySourceModel />);
    await waitFor(() => expect(screen.getByText('claude')).toBeInTheDocument());
    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-4')).toBeInTheDocument();
  });
});

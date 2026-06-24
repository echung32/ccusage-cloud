import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ByProject } from '../ByProject';

afterEach(() => vi.restoreAllMocks());

describe('ByProject', () => {
  it('renders the project rows sorted by cost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const body = url.startsWith('/api/me')
        ? { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }
        : {
            totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
            byDay: [], bySource: [], byModel: [],
            byProject: [{ projectPath: '/work/app', totalTokens: 450, totalCost: 3, sessions: 2 }, { projectPath: '(unknown)', totalTokens: 7, totalCost: 0.1, sessions: 1 }],
            byDevice: [],
          };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }));
    render(<ByProject />);
    await waitFor(() => expect(screen.getByText('/work/app')).toBeInTheDocument());
    expect(screen.getByText('(unknown)')).toBeInTheDocument();
  });
});

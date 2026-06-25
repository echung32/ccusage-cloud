import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ByProject } from '../ByProject';

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

describe('ByProject', () => {
  it('renders project rows in me scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        totals: { sessions: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
        byDay: [], bySource: [], byModel: [], byProject: [{ projectPath: '/mnt/dev/x', totalTokens: 50, totalCost: 0.4, sessions: 1 }], byDevice: [],
      }), { status: 200 }));
    }));
    render(<ByProject />);
    await waitFor(() => expect(screen.getByText('/mnt/dev/x')).toBeInTheDocument());
  });

  it('shows a notice and fetches nothing in group scope', async () => {
    window.history.replaceState({}, '', '/projects?scope=group');
    const f = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', f);
    render(<ByProject />);
    await waitFor(() => expect(screen.getByText(/My view/i)).toBeInTheDocument());
    expect(f).not.toHaveBeenCalled();
  });
});

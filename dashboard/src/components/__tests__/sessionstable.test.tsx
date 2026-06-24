import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsTable } from '../SessionsTable';

afterEach(() => vi.restoreAllMocks());

describe('SessionsTable', () => {
  it('does not fetch and shows a notice in group scope', async () => {
    const original = window.location.search;
    window.history.replaceState(null, '', '?scope=group');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<SessionsTable />);
    // The notice text "My view" is split across a <strong>My</strong> + text node; match the paragraph
    await screen.findAllByText((_, element) => element?.tagName === 'P' && /my view/i.test(element.textContent ?? ''));
    expect(f).not.toHaveBeenCalled();
    window.history.replaceState(null, '', original || '/');
  });

  it('renders the first page and loads more via the cursor', async () => {
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      }
      if (url.includes('cursor=CUR')) {
        return Promise.resolve(new Response(JSON.stringify({
          sessions: [{ source: 'claude', sessionId: 's2', deviceId: 'd1', totalTokens: 200, totalCost: 2, firstActivity: null, lastActivity: '2026-06-20T00:00:00.000Z', modelsUsed: [], projectPath: '/p' }],
          nextCursor: null,
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        sessions: [{ source: 'claude', sessionId: 's1', deviceId: 'd1', totalTokens: 100, totalCost: 1, firstActivity: null, lastActivity: '2026-06-21T00:00:00.000Z', modelsUsed: [], projectPath: '/p' }],
        nextCursor: 'CUR',
      }), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText('s1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(screen.getByText('s2')).toBeInTheDocument());
    expect(screen.getByText('s1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsTable } from '../SessionsTable';

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

describe('SessionsTable', () => {
  it('renders session rows in me scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ sessions: [{ source: 'claude-code', sessionId: 'abc', deviceId: 'd1', totalTokens: 100, totalCost: 0.5, firstActivity: null, lastActivity: '2026-06-24T10:00:00Z', modelsUsed: ['claude-opus-4-8'], projectPath: '/p' }], nextCursor: null }), { status: 200 }));
    }));
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText('abc')).toBeInTheDocument());
  });

  it('shows a notice and fetches nothing in group scope', async () => {
    window.history.replaceState({}, '', '/sessions?scope=group');
    const f = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', f);
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText(/My view/i)).toBeInTheDocument());
    expect(f).not.toHaveBeenCalled();
  });

  it('renders the property filter with accessible labels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ sessions: [{ source: 'claude-code', sessionId: 'abc', deviceId: 'd1', totalTokens: 100, totalCost: 0.5, firstActivity: null, lastActivity: '2026-06-24T10:00:00Z', modelsUsed: ['claude-opus-4-8'], projectPath: '/p' }], nextCursor: null }), { status: 200 }));
    }));
    render(<SessionsTable />);
    await waitFor(() => expect(screen.getByText('abc')).toBeInTheDocument());
    // i18nStrings.filteringAriaLabel is applied to the search input.
    expect(screen.getByLabelText('Find sessions')).toBeInTheDocument();
  });

  it('narrows visible rows when a PropertyFilter token is applied', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        sessions: [
          { source: 'claude-code', sessionId: 's1', deviceId: 'd1', totalTokens: 100, totalCost: 0.5, firstActivity: null, lastActivity: '2026-06-24T10:00:00Z', modelsUsed: ['claude-opus-4-8'], projectPath: '/p1' },
          { source: 'cursor', sessionId: 's2', deviceId: 'd1', totalTokens: 200, totalCost: 1.0, firstActivity: null, lastActivity: '2026-06-24T11:00:00Z', modelsUsed: ['gpt-4'], projectPath: '/p2' },
        ],
        nextCursor: null,
      }), { status: 200 }));
    }));
    render(<SessionsTable />);
    // Both rows visible initially.
    await waitFor(() => expect(screen.getByText('s1')).toBeInTheDocument());
    expect(screen.getByText('s2')).toBeInTheDocument();

    // Type 'cursor' into the PropertyFilter input and select the free-text option.
    const filterInput = screen.getByLabelText('Find sessions');
    await userEvent.type(filterInput, 'cursor');
    // The Cloudscape autosuggest shows a 'Use: "cursor"' option for free-text filtering.
    const enteredOption = await screen.findByText('Use: "cursor"');
    await userEvent.click(enteredOption);

    // After filtering, only the 'cursor' row should remain.
    await waitFor(() => expect(screen.queryByText('s1')).not.toBeInTheDocument());
    expect(screen.getByText('s2')).toBeInTheDocument();
  });
});

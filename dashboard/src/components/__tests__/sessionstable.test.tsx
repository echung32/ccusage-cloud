import { render, screen, waitFor } from '@testing-library/react';
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
});

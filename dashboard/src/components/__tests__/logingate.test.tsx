import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginGate } from '../LoginGate';

afterEach(() => vi.restoreAllMocks());

describe('LoginGate', () => {
  it('shows the email form when anonymous and sends a magic link', async () => {
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/me')) return Promise.resolve(new Response('{}', { status: 401 }));
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<LoginGate />);
    const email = await screen.findByLabelText('email');
    await userEvent.type(email, 'me@x.com');
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeInTheDocument());
    // Exactly one POST to /auth/request — verifies no double-submit regression
    const authRequests = f.mock.calls.filter(([url]: [string]) => url === '/auth/request');
    expect(authRequests).toHaveLength(1);
    expect(authRequests[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });
});

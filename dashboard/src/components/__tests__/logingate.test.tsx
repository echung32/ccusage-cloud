import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginGate } from '../LoginGate';

afterEach(() => vi.restoreAllMocks());

describe('LoginGate', () => {
  it('sends an authenticated viewer to /overview', async () => {
    const loc = { href: 'https://ccusage.ethanchung.dev/' } as unknown as Location;
    vi.stubGlobal('location', loc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'gh|a', email: null, publicToGroup: false, devices: [] }), { status: 200 })));
    render(<LoginGate />);
    await waitFor(() => expect(loc.href).toContain('/overview'));
  });

  it('shows the not-authorized state when returned=1 and still unauthenticated', async () => {
    const loc = { href: 'https://ccusage.ethanchung.dev/?returned=1' } as unknown as Location;
    vi.stubGlobal('location', loc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<LoginGate />);
    await waitFor(() => expect(screen.getByText(/not authorized/i)).toBeInTheDocument());
  });

  it('renders no email form', async () => {
    vi.stubGlobal('location', { href: 'https://ccusage.ethanchung.dev/' } as unknown as Location);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<LoginGate />);
    await waitFor(() => expect(screen.queryByLabelText('email')).not.toBeInTheDocument());
  });
});

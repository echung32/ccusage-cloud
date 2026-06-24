import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsDevices } from '../SettingsDevices';

afterEach(() => vi.restoreAllMocks());

const me = { id: 'u1', email: 'a@b.c', publicToGroup: false, devices: [{ id: 'd1', label: 'laptop', createdAt: 0, lastSeenAt: null, revokedAt: null }] };

describe('SettingsDevices', () => {
  it('lists devices and toggles group sharing', async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/me') && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ publicToGroup: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<SettingsDevices />);
    await waitFor(() => expect(screen.getByText('laptop')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' })));
  });

  it('adds a device and shows the token once', async () => {
    const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/devices' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'd2', token: 'cccloud_secret' }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(me), { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<SettingsDevices />);
    await waitFor(() => screen.getByText('laptop'));
    await userEvent.type(screen.getByLabelText('new device label'), 'phone');
    await userEvent.click(screen.getByRole('button', { name: /add device/i }));
    await waitFor(() => expect(screen.getByText('cccloud_secret')).toBeInTheDocument());
  });
});

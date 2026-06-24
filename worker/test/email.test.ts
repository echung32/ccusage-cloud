import { describe, expect, it, vi } from 'vitest';
import { MAGIC_SENDER, sendMagicLink } from '../src/email';
import type { Env } from '../src/env';

describe('sendMagicLink', () => {
  it('sends from the configured sender and includes the link', async () => {
    const send = vi.fn(async () => {});
    const env = { EMAIL: { send } } as unknown as Env;
    await sendMagicLink(env, 'me@example.com', 'https://x.dev/auth/callback?token=abc');
    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0]![0] as { to: string; from: { email: string }; html: string; text: string };
    expect(msg.to).toBe('me@example.com');
    expect(msg.from.email).toBe(MAGIC_SENDER);
    expect(msg.text).toContain('https://x.dev/auth/callback?token=abc');
    expect(msg.html).toContain('https://x.dev/auth/callback?token=abc');
  });

  it('is a no-op (no throw) when EMAIL is not configured', async () => {
    const env = {} as Env;
    await expect(sendMagicLink(env, 'me@example.com', 'https://x.dev/l')).resolves.toBeUndefined();
  });
});

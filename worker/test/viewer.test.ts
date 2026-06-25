import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { installJwks, authFetch, mintToken } from './auth-fixture';

describe('requireUser', () => {
  beforeAll(() => installJwks());

  it('401s without a token', async () => {
    const res = await SELF.fetch('https://example.com/api/me');
    expect(res.status).toBe(401);
  });

  it('verifies a token and provisions the user keyed by sub', async () => {
    const res = await authFetch('/api/me', 'gh|alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('gh|alice');
    const row = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind('gh|alice').first();
    expect(row).not.toBeNull();
  });

  it('provisioning is idempotent across requests', async () => {
    await authFetch('/api/me', 'gh|bob');
    await authFetch('/api/me', 'gh|bob');
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind('gh|bob').first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('401s for a malformed token', async () => {
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('401s for a tampered (signature-invalid) token', async () => {
    // Replace the signature segment with an all-zero base64url string of the
    // correct length (86 chars for a 64-byte EdDSA signature). All characters
    // are significant in a fixed signature like this, so it never accidentally
    // passes — unlike flipping only the last char, which encodes just 2
    // significant bits and may leave the signature unchanged after rounding.
    const [header, payload] = (await mintToken({ sub: 'gh|x' })).split('.');
    const tampered = `${header}.${payload}.${'A'.repeat(86)}`;
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.status).toBe(401);
  });
});

// Note: mintToken always sets issuer/audience to the AUTH values and a 5-minute
// expiry, so wrong-issuer/expired cases would need a parameterized variant; the
// malformed + tampered cases above already exercise the verification-failure path.

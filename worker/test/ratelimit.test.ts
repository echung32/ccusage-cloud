import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../src/ratelimit';

describe('rateLimit', () => {
  it('allows up to the limit then blocks', async () => {
    const key = `k-${Math.random()}`;
    const r1 = await rateLimit(env.RATE_LIMITS, key, 2, 60);
    const r2 = await rateLimit(env.RATE_LIMITS, key, 2, 60);
    const r3 = await rateLimit(env.RATE_LIMITS, key, 2, 60);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false);
    expect(r3.remaining).toBe(0);
  });
  it('separate keys have separate budgets', async () => {
    const a = await rateLimit(env.RATE_LIMITS, `a-${Math.random()}`, 1, 60);
    const b = await rateLimit(env.RATE_LIMITS, `b-${Math.random()}`, 1, 60);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

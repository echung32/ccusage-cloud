import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('usage_daily migration', () => {
  it('exposes a writable usage_daily table keyed by (user,device,source,day)', async () => {
    await env.DB.prepare(
      'INSERT INTO usage_daily (user_id, device_id, source, day, total_tokens, total_cost, updated_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind('usr_x', 'dev_x', 'claude', '2026-06-01', 100, 0.5, 1000)
      .run();
    const row = await env.DB.prepare(
      'SELECT total_tokens AS t, total_cost AS c FROM usage_daily WHERE user_id=? AND device_id=? AND source=? AND day=?',
    )
      .bind('usr_x', 'dev_x', 'claude', '2026-06-01')
      .first<{ t: number; c: number }>();
    expect(row?.t).toBe(100);
    expect(row?.c).toBe(0.5);
  });
});

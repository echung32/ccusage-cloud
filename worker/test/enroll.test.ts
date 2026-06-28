import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser } from './seed';

describe('enroll_codes migration', () => {
  it('exposes a writable enroll_codes table', async () => {
    const { userId } = await seedUser(env);
    await env.DB.prepare(
      'INSERT INTO enroll_codes (code_sha256, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
      .bind('hash_abc', userId, 1000, 2000)
      .run();
    const row = await env.DB.prepare('SELECT user_id, used_at FROM enroll_codes WHERE code_sha256 = ?')
      .bind('hash_abc')
      .first<{ user_id: string; used_at: number | null }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.used_at).toBeNull();
  });
});

import type { Context } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { randomToken } from './tokens';
import { sha256Hex } from './crypto';
import { rateLimit } from './ratelimit';

const CODE_TTL_MS = 15 * 60 * 1000;

const EnrollSchema = v.object({
  code: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
});

export const mintEnrollCode = async (c: Context<AppBindings>) => {
  const { userId } = c.var.viewer;
  const code = randomToken('ec_');
  const codeHash = await sha256Hex(code);
  const now = Date.now();
  const expiresAt = now + CODE_TTL_MS;
  await c.env.DB.prepare(
    'INSERT INTO enroll_codes (code_sha256, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(codeHash, userId, now, expiresAt)
    .run();
  return c.json({ code, expiresAt });
};

export const redeemEnrollCode = async (c: Context<AppBindings>) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env.RATE_LIMITS, `enroll:${ip}`, 30, 60);
  if (!rl.ok) return c.json({ error: 'rate limited' }, 429);

  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(EnrollSchema, body);
  if (!parsed.success) return c.json({ error: 'invalid payload' }, 400);

  const codeHash = await sha256Hex(parsed.output.code);
  const now = Date.now();
  const row = await c.env.DB.prepare('SELECT user_id FROM enroll_codes WHERE code_sha256 = ?')
    .bind(codeHash)
    .first<{ user_id: string }>();
  if (!row) return c.json({ error: 'invalid or expired code' }, 410);

  // Atomically claim the code: only succeeds if still unused and unexpired.
  const claim = await c.env.DB.prepare(
    'UPDATE enroll_codes SET used_at = ? WHERE code_sha256 = ? AND used_at IS NULL AND expires_at > ?',
  )
    .bind(now, codeHash, now)
    .run();
  if (claim.meta.changes === 0) return c.json({ error: 'invalid or expired code' }, 410);

  const token = randomToken('cccloud_');
  const tokenHash = await sha256Hex(token);
  const id = `dev_${randomToken('', 12).slice(0, 16)}`;
  await c.env.DB.prepare(
    'INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, row.user_id, tokenHash, parsed.output.label, now)
    .run();
  return c.json({ id, token });
};

import type { Context } from 'hono';
import type { AppBindings } from './env';
import { randomToken } from './tokens';
import { sha256Hex } from './crypto';

const CODE_TTL_MS = 15 * 60 * 1000;

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

import { createMiddleware } from 'hono/factory';
import type { AppBindings } from './env';
import { sha256Hex } from './crypto';

export const deviceAuth = createMiddleware<AppBindings>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'missing token' }, 401);
  }
  const tokenHash = await sha256Hex(header.slice('Bearer '.length));
  const row = await c.env.DB.prepare(
    'SELECT id, user_id FROM devices WHERE token_sha256 = ? AND revoked_at IS NULL',
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: string }>();
  if (!row) {
    return c.json({ error: 'invalid token' }, 401);
  }
  c.set('device', { userId: row.user_id, deviceId: row.id });
  await next();
});

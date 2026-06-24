import { Hono } from 'hono';
import type { AppBindings } from './env';
import { requireViewer } from './viewer';

export const apiRoutes = new Hono<AppBindings>();

apiRoutes.use('/api/*', requireViewer);

apiRoutes.get('/api/me', async (c) => {
  const { userId } = c.var.viewer;
  const user = await c.env.DB.prepare('SELECT id, email, public_to_group FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; public_to_group: number }>();
  if (!user) return c.json({ error: 'not found' }, 404);
  const devices = await c.env.DB.prepare(
    'SELECT id, label, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ? ORDER BY created_at',
  )
    .bind(userId)
    .all<{ id: string; label: string; created_at: number; last_seen_at: number | null; revoked_at: number | null }>();
  return c.json({
    id: user.id,
    email: user.email,
    publicToGroup: user.public_to_group === 1,
    devices: devices.results.map((d) => ({
      id: d.id,
      label: d.label,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
    })),
  });
});

import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { requireViewer } from './viewer';
import { randomToken } from './tokens';
import { sha256Hex } from './crypto';

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

const NewDeviceSchema = v.object({ label: v.pipe(v.string(), v.minLength(1), v.maxLength(100)) });

apiRoutes.post('/api/devices', async (c) => {
  const { userId } = c.var.viewer;
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(NewDeviceSchema, body);
  if (!parsed.success) return c.json({ error: 'invalid label' }, 400);

  const token = randomToken('cccloud_');
  const tokenHash = await sha256Hex(token);
  const id = `dev_${randomToken('', 12).slice(0, 16)}`;
  await c.env.DB.prepare(
    'INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, tokenHash, parsed.output.label, Date.now())
    .run();
  return c.json({ id, token }); // plaintext shown once
});

apiRoutes.delete('/api/devices/:id', async (c) => {
  const { userId } = c.var.viewer;
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(Date.now(), id, userId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

const PatchMeSchema = v.object({ publicToGroup: v.boolean() });

apiRoutes.patch('/api/me', async (c) => {
  const { userId } = c.var.viewer;
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(PatchMeSchema, body);
  if (!parsed.success) return c.json({ error: 'invalid payload' }, 400);
  await c.env.DB.prepare('UPDATE users SET public_to_group = ? WHERE id = ?')
    .bind(parsed.output.publicToGroup ? 1 : 0, userId)
    .run();
  return c.json({ publicToGroup: parsed.output.publicToGroup });
});

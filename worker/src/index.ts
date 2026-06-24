import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { deviceAuth } from './auth';
import { IngestSchema } from './schema';
import { upsertSessions } from './db';
import { authRoutes } from './auth_routes';
import { apiRoutes } from './api';
import { readApiRoutes } from './read_api';

const app = new Hono<AppBindings>();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/ingest', deviceAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(IngestSchema, body);
  if (!parsed.success) {
    return c.json({ error: 'invalid payload' }, 400);
  }
  const { userId, deviceId } = c.var.device;
  const upserted = await upsertSessions(c.env.DB, userId, deviceId, parsed.output.sessions);
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?')
    .bind(Date.now(), deviceId)
    .run();
  return c.json({ upserted, skipped: 0 });
});

app.route('/', authRoutes);
app.route('/', apiRoutes);
app.route('/', readApiRoutes);

export default app;

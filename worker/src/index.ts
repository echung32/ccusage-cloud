import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { deviceAuth } from './auth';
import { IngestSchema } from './schema';
import { upsertSessions } from './db';
import { apiRoutes } from './api';
import { readApiRoutes } from './read_api';
import { rateLimit } from './ratelimit';
import { safeLog } from './log';

const app = new Hono<AppBindings>();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/ingest', deviceAuth, async (c) => {
  const rl = await rateLimit(c.env.RATE_LIMITS, `ingest:${c.var.device.deviceId}`, 600, 60);
  if (!rl.ok) return c.json({ error: 'rate limited' }, 429);
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(IngestSchema, body);
  if (!parsed.success) {
    return c.json({ error: 'invalid payload' }, 400);
  }
  const { userId, deviceId } = c.var.device;
  const upserted = await upsertSessions(c.env.DB, userId, deviceId, parsed.output.sessions);
  safeLog('ingest', { deviceId, upserted });
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?')
    .bind(Date.now(), deviceId)
    .run();
  return c.json({ upserted, skipped: 0 });
});

app.route('/', apiRoutes);
app.route('/', readApiRoutes);

// Non-API paths are served by the static dashboard via the Assets binding.
// Registered last so /health, /ingest, /auth/*, and /api/* always win.
// With `not_found_handling: "none"`, unknown paths come back as 404 from the
// asset layer and that status is propagated as-is (no SPA index.html shell).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

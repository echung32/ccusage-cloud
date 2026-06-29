import { createMiddleware } from 'hono/factory';
import type { AppBindings } from './env';
import { rateLimit } from './ratelimit';

export const READ_RATE_LIMIT = 300;
export const READ_RATE_WINDOW = 60;

// Per-user rate limit for authenticated read APIs. Runs after requireUser so the
// key is the verified user. Both /api/* sub-routers (apiRoutes + readApiRoutes)
// match read endpoints, so guard with a request-scoped flag to count each
// request exactly once.
export const viewerRateLimit = createMiddleware<AppBindings>(async (c, next) => {
  if (c.get('rlChecked')) return next();
  c.set('rlChecked', true);
  const { userId } = c.var.viewer;
  const rl = await rateLimit(c.env.RATE_LIMITS, `viewer:${userId}`, READ_RATE_LIMIT, READ_RATE_WINDOW);
  if (!rl.ok) return c.json({ error: 'rate limited' }, 429);
  return next();
});

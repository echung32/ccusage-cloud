import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from './env';
import { getViewerSession } from './kv';
import { SESSION_COOKIE } from './auth_routes';

export const requireViewer = createMiddleware<AppBindings>(async (c, next) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return c.json({ error: 'not authenticated' }, 401);
  const session = await getViewerSession(c.env, sid);
  if (!session) return c.json({ error: 'not authenticated' }, 401);
  c.set('viewer', { userId: session.userId });
  await next();
});

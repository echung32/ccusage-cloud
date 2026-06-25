import { createMiddleware } from 'hono/factory';
import { requireUser as verifyUser } from 'auth-verify';
import type { AppBindings } from './env';
import { AUTH } from './auth_config';

interface VerifiedUser {
  sub: string;
  email: string | null;
  name: string | null;
  scopes: string[];
}

export const requireUser = createMiddleware<AppBindings>(async (c, next) => {
  let u: VerifiedUser;
  try {
    u = (await verifyUser(c.req.raw, AUTH)) as VerifiedUser;
  } catch (e) {
    if (e instanceof Response) return e; // auth-verify throws a 401 Response
    return c.json({ error: 'auth unavailable' }, 503); // e.g. JWKS fetch failure
  }
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, name, public_to_group, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING',
  )
    .bind(u.sub, u.email, u.name, Date.now())
    .run();
  c.set('viewer', { userId: u.sub });
  await next();
});

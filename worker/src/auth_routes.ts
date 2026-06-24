import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { consumeLoginToken, deleteViewerSession, putLoginToken, putViewerSession } from './kv';
import { randomBase64Url } from './tokens';
import { sendMagicLink } from './email';

const RequestSchema = v.object({ email: v.pipe(v.string(), v.email()) });

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/auth/request', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = v.safeParse(RequestSchema, body);
  // Always 200 (no enumeration), even on malformed input.
  if (!parsed.success) return c.json({ ok: true });

  const email = parsed.output.email.toLowerCase();
  const allowed = await c.env.DB.prepare('SELECT email FROM allowed_emails WHERE email = ?')
    .bind(email)
    .first<{ email: string }>();
  if (allowed) {
    const token = randomBase64Url(32);
    await putLoginToken(c.env, token, email);
    const link = new URL(`/auth/callback?token=${token}`, c.req.url).toString();
    try {
      await sendMagicLink(c.env, email, link);
    } catch {
      // Token is minted; never 500 after that. User can re-request.
    }
  }
  return c.json({ ok: true });
});

export const SESSION_COOKIE = 'ccusage_session';

authRoutes.get('/auth/callback', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'missing token' }, 401);
  const consumed = await consumeLoginToken(c.env, token);
  if (!consumed) return c.json({ error: 'invalid or expired token' }, 401);

  // Resolve or provision the user for this allow-listed email.
  const email = consumed.email;
  let user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) {
    const id = `usr_${randomBase64Url(12)}`;
    await c.env.DB.prepare('INSERT INTO users (id, email, public_to_group, created_at) VALUES (?, ?, 0, ?)')
      .bind(id, email, Date.now())
      .run();
    user = { id };
  }

  const sid = randomBase64Url(32);
  await putViewerSession(c.env, sid, user.id);
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 2_592_000,
  });
  return c.redirect('/', 302);
});

authRoutes.post('/auth/logout', async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await deleteViewerSession(c.env, sid);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

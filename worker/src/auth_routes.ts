import { Hono } from 'hono';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { putLoginToken } from './kv';
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

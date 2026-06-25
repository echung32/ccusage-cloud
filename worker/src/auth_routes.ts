import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as v from 'valibot';
import type { AppBindings } from './env';
import { consumeLoginToken, deleteViewerSession, putLoginToken, putViewerSession } from './kv';
import { randomBase64Url } from './tokens';
import { sendMagicLink } from './email';
import { rateLimit } from './ratelimit';
import { safeLog } from './log';

const RequestSchema = v.object({ email: v.pipe(v.string(), v.email()) });

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/auth/request', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env.RATE_LIMITS, `auth:${ip}`, 30, 60);
  if (!rl.ok) return c.json({ ok: true });
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
  safeLog('auth_request', { allowed: Boolean(allowed) });
  return c.json({ ok: true });
});

export const SESSION_COOKIE = 'ccusage_session';

// A bare GET must NOT consume the single-use token. Email scanners and link
// crawlers (observed in prod: CopyousBot) issue a GET on the magic link and would
// burn the token before the human clicks, leaving the real click with "invalid or
// expired token". Instead, render a minimal page that POSTs the token back to
// complete sign-in: real browsers auto-submit via JS (with a <noscript> button as
// fallback), while non-JS crawlers render the page and never POST, so the token
// survives until the user actually clicks.
authRoutes.get('/auth/callback', (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'missing token' }, 401);
  return c.html(signInConfirmPage(token));
});

authRoutes.post('/auth/callback', async (c) => {
  const form = await c.req.parseBody();
  const token = typeof form.token === 'string' ? form.token : '';
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

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Minimal interstitial that POSTs the magic-link token back to /auth/callback.
// JS auto-submits for real browsers; the <noscript> button covers JS-disabled
// users. Crawlers that only GET never reach the POST, so the token is preserved.
function signInConfirmPage(token: string): string {
  const t = escapeHtmlAttr(token);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Signing in… — ccusage-cloud</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#0f172a}form{text-align:center}button{font:inherit;margin-top:.75rem;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #cbd5e1;background:#2563eb;color:#fff;cursor:pointer}</style>
</head>
<body>
<form id="signin" method="POST" action="/auth/callback">
<input type="hidden" name="token" value="${t}">
<p>Signing you in…</p>
<noscript><p>Click to finish signing in to ccusage-cloud:</p><button type="submit">Sign in</button></noscript>
</form>
<script>document.getElementById('signin').submit();</script>
</body>
</html>`;
}

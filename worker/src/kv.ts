import type { Env } from './env';

const LOGIN_TTL = 900; // 15 min
const SESSION_TTL = 2_592_000; // 30 days

export async function putLoginToken(env: Env, token: string, email: string, ttl = LOGIN_TTL): Promise<void> {
  await env.LOGIN_TOKENS.put(token, JSON.stringify({ email }), { expirationTtl: ttl });
}

export async function consumeLoginToken(env: Env, token: string): Promise<{ email: string } | null> {
  const raw = await env.LOGIN_TOKENS.get(token);
  if (raw === null) return null;
  await env.LOGIN_TOKENS.delete(token); // single-use
  return JSON.parse(raw) as { email: string };
}

export async function putViewerSession(env: Env, sid: string, userId: string, ttl = SESSION_TTL): Promise<void> {
  await env.VIEWER_SESSIONS.put(sid, JSON.stringify({ userId }), { expirationTtl: ttl });
}

export async function getViewerSession(
  env: Env,
  sid: string,
  refresh = true,
): Promise<{ userId: string } | null> {
  const raw = await env.VIEWER_SESSIONS.get(sid);
  if (raw === null) return null;
  const value = JSON.parse(raw) as { userId: string };
  if (refresh) await env.VIEWER_SESSIONS.put(sid, raw, { expirationTtl: SESSION_TTL }); // sliding
  return value;
}

export async function deleteViewerSession(env: Env, sid: string): Promise<void> {
  await env.VIEWER_SESSIONS.delete(sid);
}

export async function rateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);
  const k = `rl:${key}:${bucket}`;
  const current = Number((await kv.get(k)) ?? '0');
  if (current >= limit) return { ok: false, remaining: 0 };
  const next = current + 1;
  // expire a little after the window closes so stale buckets self-clean
  await kv.put(k, String(next), { expirationTtl: windowSec + 60 });
  return { ok: true, remaining: Math.max(0, limit - next) };
}

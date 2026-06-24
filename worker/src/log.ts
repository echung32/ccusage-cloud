const DENY = new Set(['token', 'authorization', 'cookie', 'email', 'password', 'secret']);

export function safeLog(event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = { event };
  for (const [k, v] of Object.entries(fields)) {
    if (DENY.has(k.toLowerCase())) continue;
    safe[k] = v;
  }
  console.log(JSON.stringify(safe));
}

import type { Env } from './env';

// The onboarded Cloudflare Email Sending domain is the apex `ethanchung.dev`
// (the from-domain must match the enabled Email Sending domain).
export const MAGIC_SENDER = 'noreply@ethanchung.dev';

export async function sendMagicLink(env: Env, to: string, link: string): Promise<void> {
  if (!env.EMAIL) return; // not configured (e.g. local/test) — caller still returns 200
  await env.EMAIL.send({
    to,
    from: { email: MAGIC_SENDER, name: 'ccusage-cloud' },
    subject: 'Your ccusage-cloud sign-in link',
    text: `Sign in to ccusage-cloud:\n\n${link}\n\nThis link expires in 15 minutes and can be used once.`,
    html: `<p>Sign in to ccusage-cloud:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes and can be used once.</p>`,
  });
}

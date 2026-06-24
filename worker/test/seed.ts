import { sha256Hex } from '../src/crypto';
import type { Env } from '../src/env';

let counter = 0;

export async function seedDevice(
  env: Env,
  email = `user${counter}@example.com`,
  label = 'test-device',
): Promise<{ token: string; userId: string; deviceId: string }> {
  counter += 1;
  const token = `cccloud_test_${counter}`;
  const tokenHash = await sha256Hex(token);
  const userId = `usr_${counter}`;
  const deviceId = `dev_${counter}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO allowed_emails (email, added_at) VALUES (?, ?)').bind(email, now),
    env.DB
      .prepare('INSERT INTO users (id, email, public_to_group, created_at) VALUES (?, ?, 0, ?)')
      .bind(userId, email, now),
    env.DB
      .prepare(
        'INSERT INTO devices (id, user_id, token_sha256, label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(deviceId, userId, tokenHash, label, now),
  ]);
  return { token, userId, deviceId };
}

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, seedDevice, seedSession } from './seed';

describe('seedSession', () => {
  it('inserts a sessions row scoped to the user and device', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `dev-${userId}@example.com`);
    const { sessionId } = await seedSession(env, {
      userId,
      deviceId,
      source: 'claude',
      totalTokens: 1234,
      totalCost: 0.5,
      lastActivity: '2026-06-20T10:00:00.000Z',
      modelsUsed: ['claude-opus-4'],
      projectPath: '/work/app',
    });
    const row = await env.DB.prepare(
      'SELECT user_id, device_id, source, total_tokens, total_cost, last_activity, models_used, project_path FROM sessions WHERE user_id = ? AND session_id = ?',
    )
      .bind(userId, sessionId)
      .first<{
        user_id: string;
        device_id: string;
        source: string;
        total_tokens: number;
        total_cost: number;
        last_activity: string;
        models_used: string;
        project_path: string;
      }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.device_id).toBe(deviceId);
    expect(row?.source).toBe('claude');
    expect(row?.total_tokens).toBe(1234);
    expect(row?.total_cost).toBeCloseTo(0.5);
    expect(row?.last_activity).toBe('2026-06-20T10:00:00.000Z');
    expect(JSON.parse(row!.models_used)).toEqual(['claude-opus-4']);
    expect(row?.project_path).toBe('/work/app');
  });

  it('applies sensible defaults and a unique session id per call', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `dev2-${userId}@example.com`);
    const a = await seedSession(env, { userId, deviceId });
    const b = await seedSession(env, { userId, deviceId });
    expect(a.sessionId).not.toBe(b.sessionId);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
      .bind(userId)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});

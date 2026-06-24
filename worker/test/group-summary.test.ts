import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, seedDevice, seedSession } from './seed';
import { groupSummaryQuery } from '../src/queries';

async function optIn(userId: string) {
  await env.DB.prepare('UPDATE users SET public_to_group = 1 WHERE id = ?').bind(userId).run();
}

describe('groupSummaryQuery', () => {
  it('aggregates only opted-in users, overall-only (no project), by person', async () => {
    // opted-in user A
    const { userId: a, email: ea } = await seedUser(env);
    await optIn(a);
    const { deviceId: da } = await seedDevice(env, `dev-a-${a}@example.com`, 'laptop');
    await seedSession(env, { userId: a, deviceId: da, source: 'claude', totalTokens: 100, totalCost: 1, lastActivity: '2026-06-20T10:00:00.000Z', projectPath: '/secret/app', modelsUsed: ['claude-opus-4'], modelBreakdowns: [{ modelName: 'claude-opus-4', inputTokens: 60, outputTokens: 40, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 1 }] });
    // opted-in user B
    const { userId: b, email: eb } = await seedUser(env);
    await optIn(b);
    const { deviceId: db2 } = await seedDevice(env, `dev-b-${b}@example.com`, 'desktop');
    await seedSession(env, { userId: b, deviceId: db2, source: 'codex', totalTokens: 50, totalCost: 0.5, lastActivity: '2026-06-21T10:00:00.000Z', projectPath: '/other', modelsUsed: ['gpt-5'], modelBreakdowns: [{ modelName: 'gpt-5', inputTokens: 30, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0.5 }] });
    // opted-OUT user C (must never appear)
    const { userId: c } = await seedUser(env);
    const { deviceId: dc } = await seedDevice(env, `dev-c-${c}@example.com`, 'private');
    await seedSession(env, { userId: c, deviceId: dc, totalTokens: 99999, totalCost: 999, lastActivity: '2026-06-21T10:00:00.000Z' });

    const s = await groupSummaryQuery(env.DB, {});
    expect(s.totals.totalTokens).toBe(150);
    expect(s.totals.totalCost).toBeCloseTo(1.5);
    expect(s.byProject).toEqual([]); // overall-only: never expose projects
    // by person: keyed by user, labeled by email
    const people = Object.fromEntries(s.byDevice.map((d) => [d.label, d.totalTokens]));
    expect(people[ea]).toBe(100);
    expect(people[eb]).toBe(50);
    expect(s.byDevice.some((d) => d.totalTokens === 99999)).toBe(false);
    // sources/models still aggregate over opted-in only
    expect(s.bySource.some((r) => r.source === 'codex')).toBe(true);
    expect(s.byModel.some((m) => m.model === 'gpt-5')).toBe(true);
    expect(s.byModel.some((m) => m.totalTokens === 99999)).toBe(false);
  });

  it('returns empty aggregates when nobody opted in', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `solo-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, totalTokens: 5, lastActivity: '2026-06-20T00:00:00.000Z' });
    const s = await groupSummaryQuery(env.DB, {});
    expect(s.totals.sessions).toBe(0);
    expect(s.byDevice).toEqual([]);
    expect(s.byProject).toEqual([]);
  });

  it('honors from/to/source filters in group scope', async () => {
    const { userId } = await seedUser(env);
    await optIn(userId);
    const { deviceId } = await seedDevice(env, `flt-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, source: 'claude', totalTokens: 10, lastActivity: '2026-06-20T00:00:00.000Z' });
    await seedSession(env, { userId, deviceId, source: 'codex', totalTokens: 20, lastActivity: '2026-06-21T00:00:00.000Z' });
    const onlyCodex = await groupSummaryQuery(env.DB, { source: 'codex' });
    expect(onlyCodex.totals.totalTokens).toBe(20);
  });
});

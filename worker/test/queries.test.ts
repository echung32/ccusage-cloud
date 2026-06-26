import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, seedDevice, seedSession } from './seed';
import { summaryQuery, sessionsPage } from '../src/queries';

async function setupTwoDevicesTwoSources() {
  const { userId } = await seedUser(env);
  const { deviceId: dA } = await seedDevice(env, `a-${userId}@example.com`, 'laptop');
  const { deviceId: dB } = await seedDevice(env, `b-${userId}@example.com`, 'desktop');
  // device A, claude, two models
  await seedSession(env, {
    userId, deviceId: dA, source: 'claude', sessionId: 's1',
    inputTokens: 100, outputTokens: 50, totalTokens: 150, totalCost: 1,
    lastActivity: '2026-06-20T10:00:00.000Z', projectPath: '/work/app',
    modelsUsed: ['claude-opus-4'],
    modelBreakdowns: [{ modelName: 'claude-opus-4', inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 1 }],
  });
  await seedSession(env, {
    userId, deviceId: dA, source: 'claude', sessionId: 's2',
    inputTokens: 200, outputTokens: 100, totalTokens: 300, totalCost: 2,
    lastActivity: '2026-06-21T10:00:00.000Z', projectPath: '/work/app',
    modelsUsed: ['claude-sonnet-4'],
    modelBreakdowns: [{ modelName: 'claude-sonnet-4', inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 2 }],
  });
  // device B, codex
  await seedSession(env, {
    userId, deviceId: dB, source: 'codex', sessionId: 's3',
    inputTokens: 10, outputTokens: 5, totalTokens: 15, totalCost: 0.5,
    lastActivity: '2026-06-21T12:00:00.000Z', projectPath: '/work/other',
    modelsUsed: ['gpt-5'],
    modelBreakdowns: [{ modelName: 'gpt-5', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0.5 }],
  });
  return { userId, dA, dB };
}

describe('summaryQuery', () => {
  it('computes totals/byDay/bySource/byModel/byProject/byDevice', async () => {
    const { userId } = await setupTwoDevicesTwoSources();
    const s = await summaryQuery(env.DB, userId, {});
    expect(s.totals.sessions).toBe(3);
    expect(s.totals.totalTokens).toBe(465);
    expect(s.totals.inputTokens).toBe(310);
    expect(s.totals.outputTokens).toBe(155);
    expect(s.totals.totalCost).toBeCloseTo(3.5);

    const days = Object.fromEntries(s.byDay.map((d) => [d.day, d.totalTokens]));
    expect(days['2026-06-20']).toBe(150);
    expect(days['2026-06-21']).toBe(315);

    const src = Object.fromEntries(s.bySource.map((r) => [r.source, r.sessions]));
    expect(src['claude']).toBe(2);
    expect(src['codex']).toBe(1);

    // per-day-per-source breakdown: claude on 06-20 and 06-21, codex only on 06-21
    const ds = Object.fromEntries(s.byDaySource.map((r) => [`${r.day}|${r.source}`, r.totalTokens]));
    expect(ds['2026-06-20|claude']).toBe(150);
    expect(ds['2026-06-21|claude']).toBe(300);
    expect(ds['2026-06-21|codex']).toBe(15);
    expect(ds['2026-06-20|codex']).toBeUndefined();

    const models = Object.fromEntries(s.byModel.map((r) => [r.model, r.totalTokens]));
    expect(models['claude-opus-4']).toBe(150);
    expect(models['claude-sonnet-4']).toBe(300);
    expect(models['gpt-5']).toBe(15);

    const proj = Object.fromEntries(s.byProject.map((r) => [r.projectPath, r.totalTokens]));
    expect(proj['/work/app']).toBe(450);
    expect(proj['/work/other']).toBe(15);

    const dev = Object.fromEntries(s.byDevice.map((r) => [r.label, r.totalTokens]));
    expect(dev['laptop']).toBe(450);
    expect(dev['desktop']).toBe(15);
  });

  it('isolates by user — a second user never leaks in', async () => {
    const { userId } = await setupTwoDevicesTwoSources();
    const { userId: other } = await seedUser(env);
    const { deviceId: od } = await seedDevice(env, `o-${other}@example.com`, 'other');
    await seedSession(env, { userId: other, deviceId: od, totalTokens: 99999, totalCost: 999, lastActivity: '2026-06-21T10:00:00.000Z' });
    const s = await summaryQuery(env.DB, userId, {});
    expect(s.totals.totalTokens).toBe(465);
    expect(s.byDevice.some((d) => d.label === 'other')).toBe(false);
  });

  it('applies from/to/source/device filters', async () => {
    const { userId, dA } = await setupTwoDevicesTwoSources();
    const fromTo = await summaryQuery(env.DB, userId, { from: '2026-06-21T00:00:00.000Z', to: '2026-06-21T23:59:59.999Z' });
    expect(fromTo.totals.sessions).toBe(2);
    const onlyClaude = await summaryQuery(env.DB, userId, { source: 'claude' });
    expect(onlyClaude.totals.sessions).toBe(2);
    const onlyDeviceA = await summaryQuery(env.DB, userId, { device: dA });
    expect(onlyDeviceA.totals.sessions).toBe(2);
  });

  it('buckets NULL project_path as (unknown)', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `np-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, projectPath: null, totalTokens: 7, totalCost: 0.1 });
    const s = await summaryQuery(env.DB, userId, {});
    expect(s.byProject.find((p) => p.projectPath === '(unknown)')?.totalTokens).toBe(7);
  });
});

describe('sessionsPage', () => {
  async function seedN(userId: string, deviceId: string, n: number) {
    for (let i = 0; i < n; i++) {
      const day = String(10 + i).padStart(2, '0');
      await seedSession(env, {
        userId, deviceId, source: 'claude', sessionId: `p${i}`,
        totalTokens: i, totalCost: i / 10,
        lastActivity: `2026-06-${day}T10:00:00.000Z`,
      });
    }
  }

  it('paginates descending with a stable cursor', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `pg-${userId}@example.com`);
    await seedN(userId, deviceId, 5);
    const first = await sessionsPage(env.DB, userId, {}, null, 2);
    expect(first.sessions).toHaveLength(2);
    expect(first.sessions[0]!.sessionId).toBe('p4'); // newest
    expect(first.sessions[1]!.sessionId).toBe('p3');
    expect(first.nextCursor).not.toBeNull();
    const second = await sessionsPage(env.DB, userId, {}, first.nextCursor, 2);
    expect(second.sessions[0]!.sessionId).toBe('p2');
    expect(second.sessions[1]!.sessionId).toBe('p1');
    const third = await sessionsPage(env.DB, userId, {}, second.nextCursor, 2);
    expect(third.sessions).toHaveLength(1);
    expect(third.sessions[0]!.sessionId).toBe('p0');
    expect(third.nextCursor).toBeNull();
  });

  it('does not leak other users rows', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `pg2-${userId}@example.com`);
    await seedN(userId, deviceId, 2);
    const { userId: other } = await seedUser(env);
    const { deviceId: od } = await seedDevice(env, `pg3-${other}@example.com`);
    await seedSession(env, { userId: other, deviceId: od, sessionId: 'X', totalTokens: 1, lastActivity: '2026-07-01T00:00:00.000Z' });
    const page = await sessionsPage(env.DB, userId, {}, null, 50);
    expect(page.sessions.some((s) => s.sessionId === 'X')).toBe(false);
    expect(page.sessions).toHaveLength(2);
  });

  it('applies filters', async () => {
    const { userId } = await seedUser(env);
    const { deviceId } = await seedDevice(env, `pg4-${userId}@example.com`);
    await seedSession(env, { userId, deviceId, source: 'claude', sessionId: 'c', lastActivity: '2026-06-20T00:00:00.000Z' });
    await seedSession(env, { userId, deviceId, source: 'codex', sessionId: 'x', lastActivity: '2026-06-21T00:00:00.000Z' });
    const page = await sessionsPage(env.DB, userId, { source: 'codex' }, null, 50);
    expect(page.sessions).toHaveLength(1);
    expect(page.sessions[0]!.source).toBe('codex');
  });
});

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('migration 0001', () => {
  it('creates the expected tables', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['devices', 'sessions', 'users']),
    );
    const userCols = await env.DB.prepare('PRAGMA table_info(users)').all<{ name: string }>();
    expect(userCols.results.map((c) => c.name)).toEqual(expect.arrayContaining(['name']));
  });

  it('enforces the sessions composite primary key', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(sessions)').all<{ name: string; pk: number }>();
    const pkCols = cols.results.filter((c) => c.pk > 0).map((c) => c.name);
    expect(pkCols).toEqual(
      expect.arrayContaining(['user_id', 'device_id', 'source', 'session_id']),
    );
  });
});

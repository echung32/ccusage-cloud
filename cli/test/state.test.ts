import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffSessions, loadState, saveState, sessionHash, sessionKey, type SyncState } from '../src/state';
import type { TaggedSession } from '../src/types';

function sess(over: Partial<TaggedSession> = {}): TaggedSession {
  return {
    source: 'claude',
    sessionId: 's1',
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 2,
    totalCost: 0.1,
    firstActivity: 'a',
    lastActivity: 'b',
    modelsUsed: [],
    modelBreakdowns: null,
    projectPath: '/p',
    ...over,
  } as TaggedSession;
}

describe('sync state', () => {
  it('round-trips state and defaults when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccc-state-'));
    const path = join(dir, 'state.json');
    expect(loadState(path)).toEqual({ hashes: {}, lastSyncAt: null });
    const state: SyncState = { hashes: { 'claude\ts1': 'abc' }, lastSyncAt: 123 };
    saveState(state, path);
    expect(loadState(path)).toEqual(state);
  });

  it('diff returns only changed sessions', () => {
    const s = sess();
    const state: SyncState = { hashes: { 'claude\ts1\t/p': sessionHash(s) }, lastSyncAt: 1 };
    expect(diffSessions([s], state)).toEqual({ changed: [], unchanged: 1 });
    const changed = sess({ totalCost: 9.99 });
    expect(diffSessions([changed], state).changed).toHaveLength(1);
  });
});

describe('sessionKey grain', () => {
  it('distinguishes same sessionId across different project paths', () => {
    const base = { source: 'claude', sessionId: 's', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 } as TaggedSession;
    const a = { ...base, projectPath: '/repo' };
    const b = { ...base, projectPath: '/repo/.worktree' };
    expect(sessionKey(a)).not.toBe(sessionKey(b));
    const { changed } = diffSessions([a, b], { hashes: { [sessionKey(a)]: sessionHash(a) }, lastSyncAt: 1 });
    expect(changed).toHaveLength(1);
    expect(changed[0].projectPath).toBe('/repo/.worktree');
  });
});

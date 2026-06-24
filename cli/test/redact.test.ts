import { describe, expect, it } from 'vitest';
import { redactProjects } from '../src/redact';
import type { TaggedSession } from '../src/types';

const base: TaggedSession = {
  source: 'claude', sessionId: 's1', inputTokens: 1, outputTokens: 1,
  cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0,
  modelsUsed: [], projectPath: '/work/secret-client',
} as TaggedSession;

describe('redactProjects', () => {
  it('hashes projectPath deterministically and drops plaintext', () => {
    const [a] = redactProjects([base]);
    const [b] = redactProjects([base]);
    expect(a.projectPath).toBe(b.projectPath);            // stable
    expect(a.projectPath).not.toBe('/work/secret-client'); // no plaintext
    expect(a.projectPath).toMatch(/^[0-9a-f]{64}$/);       // sha256 hex
  });
  it('preserves null projectPath', () => {
    const [a] = redactProjects([{ ...base, projectPath: null } as TaggedSession]);
    expect(a.projectPath).toBeNull();
  });
  it('does not mutate the input', () => {
    const input = [{ ...base }] as TaggedSession[];
    redactProjects(input);
    expect(input[0].projectPath).toBe('/work/secret-client');
  });
});

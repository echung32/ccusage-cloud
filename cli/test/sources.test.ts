import { describe, expect, it } from 'vitest';
import { ALL_SOURCES } from '../src/sources';

describe('ALL_SOURCES', () => {
  it('includes claude and is a non-trivial, unique list', () => {
    expect(ALL_SOURCES).toContain('claude');
    expect(ALL_SOURCES.length).toBeGreaterThan(10);
    expect(new Set(ALL_SOURCES).size).toBe(ALL_SOURCES.length);
  });
});

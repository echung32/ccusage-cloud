import { describe, expect, it } from 'vitest';
import { randomBase64Url, randomToken } from '../src/tokens';

describe('tokens', () => {
  it('produces url-safe, unique, prefixed tokens', () => {
    const a = randomToken('cccloud_');
    const b = randomToken('cccloud_');
    expect(a.startsWith('cccloud_')).toBe(true);
    expect(a).not.toBe(b);
    expect(a.slice('cccloud_'.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomBase64Url(16)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

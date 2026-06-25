import { describe, expect, it } from 'vitest';
import { fmtInt, fmtUsd, fmtTime } from '../format';

describe('format', () => {
  it('formats integers with grouping', () => { expect(fmtInt(1000)).toBe('1,000'); expect(fmtInt(465)).toBe('465'); });
  it('formats USD to 2 dp', () => { expect(fmtUsd(3.5)).toBe('$3.50'); });
  it('formats time and null', () => {
    expect(fmtTime('2026-06-24T09:02:00Z')).toBe('2026-06-24 09:02:00 UTC');
    expect(fmtTime(null)).toBe('—');
  });
});

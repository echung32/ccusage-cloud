// dashboard/src/lib/__tests__/daterange.test.ts
import { describe, expect, it } from 'vitest';
import { rangeToFilters, filtersToRange } from '../daterange';

const NOW = new Date('2026-06-25T12:00:00.000Z');

describe('rangeToFilters', () => {
  it('maps an absolute range to start-of-day / end-of-day ISO bounds', () => {
    expect(rangeToFilters({ type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-25' })).toEqual({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-25T23:59:59.999Z',
    });
  });

  it('always makes the upper bound end-of-day so the end date is inclusive', () => {
    const { to } = rangeToFilters({ type: 'absolute', startDate: '2026-06-25', endDate: '2026-06-25' });
    expect(to).toBe('2026-06-25T23:59:59.999Z');
  });

  it('resolves a relative day range against the injected now', () => {
    expect(rangeToFilters({ type: 'relative', amount: 7, unit: 'day', key: 'last-7-days' }, NOW)).toEqual({
      from: '2026-06-18T00:00:00.000Z',
      to: '2026-06-25T23:59:59.999Z',
    });
  });

  it('clears both bounds for a null value', () => {
    expect(rangeToFilters(null)).toEqual({ from: undefined, to: undefined });
  });

  it('guards against NaN amount in relative range — returns cleared bounds', () => {
    expect(rangeToFilters({ type: 'relative', amount: NaN, unit: 'day', key: '' }, NOW)).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  it('guards against unsupported unit (month) in relative range — returns cleared bounds', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(rangeToFilters({ type: 'relative', amount: 1, unit: 'month' as any, key: '' }, NOW)).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  it('guards against inherited prototype keys as unit — returns cleared bounds', () => {
    // `unit in MS` would accept 'toString'/'constructor' (prototype chain) and
    // yield NaN → Date(NaN).toISOString() throw; own-key check must reject these.
    for (const unit of ['toString', 'constructor', 'hasOwnProperty']) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(rangeToFilters({ type: 'relative', amount: 7, unit: unit as any, key: '' }, NOW)).toEqual({
        from: undefined,
        to: undefined,
      });
    }
  });
});

describe('filtersToRange', () => {
  it('returns null when neither bound is set', () => {
    expect(filtersToRange({})).toBeNull();
  });

  it('reconstructs an absolute range from ISO bounds (round-trip)', () => {
    const filters = rangeToFilters({ type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-25' });
    expect(filtersToRange(filters)).toEqual({ type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-25' });
  });

  it('fills a missing bound with the present one', () => {
    expect(filtersToRange({ from: '2026-06-01T00:00:00.000Z' })).toEqual({
      type: 'absolute', startDate: '2026-06-01', endDate: '2026-06-01',
    });
  });
});

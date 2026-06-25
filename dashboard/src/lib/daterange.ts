// dashboard/src/lib/daterange.ts
import type { DateRangePickerProps } from '@cloudscape-design/components/date-range-picker';

type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const MS: Record<'second' | 'minute' | 'hour' | 'day' | 'week', number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

function startOfDayUtc(d: Date): string {
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function endOfDayUtc(d: Date): string {
  return `${d.toISOString().slice(0, 10)}T23:59:59.999Z`;
}

function subtract(now: Date, amount: number, unit: TimeUnit): Date {
  if (unit === 'month') {
    const d = new Date(now.getTime());
    d.setUTCMonth(d.getUTCMonth() - amount);
    return d;
  }
  if (unit === 'year') {
    const d = new Date(now.getTime());
    d.setUTCFullYear(d.getUTCFullYear() - amount);
    return d;
  }
  return new Date(now.getTime() - amount * MS[unit]);
}

export function rangeToFilters(
  value: DateRangePickerProps.Value | null,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (!value) return { from: undefined, to: undefined };
  if (value.type === 'absolute') {
    return {
      from: `${value.startDate.slice(0, 10)}T00:00:00.000Z`,
      to: `${value.endDate.slice(0, 10)}T23:59:59.999Z`,
    };
  }
  // relative
  const from = subtract(now, value.amount, value.unit as TimeUnit);
  return { from: startOfDayUtc(from), to: endOfDayUtc(now) };
}

export function filtersToRange(
  filters: { from?: string; to?: string },
): DateRangePickerProps.Value | null {
  const fromDay = filters.from?.slice(0, 10);
  const toDay = filters.to?.slice(0, 10);
  if (!fromDay && !toDay) return null;
  return { type: 'absolute', startDate: fromDay ?? toDay!, endDate: toDay ?? fromDay! };
}

// dashboard/src/lib/daterange.ts
import type { DateRangePickerProps } from '@cloudscape-design/components/date-range-picker';

/** Only ms-based units are supported; month/year are excluded due to calendar rollover issues. */
type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week';

const MS: Record<TimeUnit, number> = {
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
  // relative — guard against invalid input so this function never throws
  const unit = value.unit as string;
  if (!(unit in MS)) return { from: undefined, to: undefined };
  if (!Number.isFinite(value.amount) || value.amount <= 0) return { from: undefined, to: undefined };
  const from = subtract(now, value.amount, unit as TimeUnit);
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

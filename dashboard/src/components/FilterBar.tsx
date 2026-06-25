import Select, { type SelectProps } from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import DateRangePicker, { type DateRangePickerProps } from '@cloudscape-design/components/date-range-picker';
import { rangeToFilters, filtersToRange } from '@/lib/daterange';
import type { Filters } from '@/lib/types';

const relativeOptions: DateRangePickerProps.RelativeOption[] = [
  { key: 'last-7-days', amount: 7, unit: 'day', type: 'relative' },
  { key: 'last-14-days', amount: 14, unit: 'day', type: 'relative' },
  { key: 'last-30-days', amount: 30, unit: 'day', type: 'relative' },
  { key: 'last-90-days', amount: 90, unit: 'day', type: 'relative' },
];

const SUPPORTED_RELATIVE_UNITS = new Set(['second', 'minute', 'hour', 'day', 'week']);

const isValidRange: DateRangePickerProps['isValidRange'] = (range) => {
  if (!range) return { valid: true };
  if (range.type === 'relative') {
    if (!SUPPORTED_RELATIVE_UNITS.has(range.unit)) {
      return { valid: false, errorMessage: 'Custom ranges support days and weeks only.' };
    }
    if (!Number.isFinite(range.amount) || range.amount <= 0) {
      return { valid: false, errorMessage: 'Duration must be a positive number.' };
    }
    return { valid: true };
  }
  // absolute
  if (!range.startDate || !range.endDate) return { valid: false, errorMessage: 'Select a start and end date.' };
  if (range.startDate > range.endDate) return { valid: false, errorMessage: 'The start date must be before the end date.' };
  return { valid: true };
};

const dateRangeI18n: DateRangePickerProps.I18nStrings = {
  todayAriaLabel: 'Today',
  nextMonthAriaLabel: 'Next month',
  previousMonthAriaLabel: 'Previous month',
  customRelativeRangeOptionLabel: 'Custom range',
  customRelativeRangeOptionDescription: 'Set a custom range',
  customRelativeRangeUnitLabel: 'unit of time',
  customRelativeRangeDurationLabel: 'Duration',
  formatRelativeRange: (e) => `Last ${e.amount} ${e.unit}${e.amount === 1 ? '' : 's'}`,
  relativeModeTitle: 'Relative range',
  absoluteModeTitle: 'Absolute range',
  relativeRangeSelectionHeading: 'Choose a range',
  startDateLabel: 'Start date',
  endDateLabel: 'End date',
  clearButtonLabel: 'Clear',
  cancelButtonLabel: 'Cancel',
  applyButtonLabel: 'Apply',
};

export function FilterBar({
  filters, sources, devices, onChange,
}: { filters: Filters; sources: string[]; devices: { id: string; label: string }[]; onChange: (f: Filters) => void }) {
  const sourceOptions: SelectProps.Option[] = [{ label: 'All sources', value: '' }, ...sources.map((s) => ({ label: s, value: s }))];
  const deviceOptions: SelectProps.Option[] = [{ label: 'All devices', value: '' }, ...devices.map((d) => ({ label: d.label, value: d.id }))];
  const selSource = sourceOptions.find((o) => o.value === (filters.source ?? '')) ?? sourceOptions[0];
  const selDevice = deviceOptions.find((o) => o.value === (filters.device ?? '')) ?? deviceOptions[0];
  const set = <K extends keyof Filters>(key: K, value: string) => onChange({ ...filters, [key]: value || undefined });
  return (
    <SpaceBetween size="s" direction="horizontal">
      <FormField label="Source">
        <Select selectedOption={selSource} ariaLabel="Source" options={sourceOptions}
          onChange={({ detail }) => set('source', String(detail.selectedOption.value ?? ''))} />
      </FormField>
      <FormField label="Device">
        <Select selectedOption={selDevice} ariaLabel="Device" options={deviceOptions}
          onChange={({ detail }) => set('device', String(detail.selectedOption.value ?? ''))} />
      </FormField>
      <FormField label="Date range">
        <DateRangePicker
          value={filtersToRange(filters)}
          onChange={({ detail }) => onChange({ ...filters, ...rangeToFilters(detail.value) })}
          relativeOptions={relativeOptions}
          isValidRange={isValidRange}
          i18nStrings={dateRangeI18n}
          dateOnly
          placeholder="Filter by date range"
        />
      </FormField>
      <FormField label=" ">
        <Button onClick={() => onChange({})}>Clear</Button>
      </FormField>
    </SpaceBetween>
  );
}

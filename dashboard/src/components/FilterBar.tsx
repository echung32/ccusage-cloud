import Select, { type SelectProps } from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import type { Filters } from '@/lib/types';

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
      <FormField label=" ">
        <Button onClick={() => onChange({})}>Clear</Button>
      </FormField>
    </SpaceBetween>
  );
}

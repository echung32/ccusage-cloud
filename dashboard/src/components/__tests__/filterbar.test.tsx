import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../FilterBar';

describe('FilterBar', () => {
  it('renders source and device options', () => {
    render(<FilterBar filters={{}} sources={['claude', 'codex']} devices={[{ id: 'd1', label: 'laptop' }]} onChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'claude' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'laptop' })).toBeInTheDocument();
  });

  it('emits a filter change when a source is picked', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={{}} sources={['claude', 'codex']} devices={[]} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('source'), 'codex');
    expect(onChange).toHaveBeenCalledWith({ source: 'codex' });
  });

  it('clears all filters', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={{ source: 'claude' }} sources={['claude']} devices={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});

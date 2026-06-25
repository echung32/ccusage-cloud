import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../FilterBar';

describe('FilterBar', () => {
  it('emits a source change', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={{}} sources={['claude-code', 'cursor']} devices={[]} onChange={onChange} />);
    // Cloudscape Select renders a <button> with aria-labelledby that includes the ariaLabel span.
    // getAllByLabelText returns both the button trigger and the listbox; [0] is the trigger button.
    const trigger = screen.getAllByLabelText('Source')[0];
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByText('cursor'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: 'cursor' }));
  });
  it('clears filters', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={{ source: 'cursor' }} sources={['cursor']} devices={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});

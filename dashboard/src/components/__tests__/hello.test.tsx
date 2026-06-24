import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Hello } from '../Hello';

describe('Hello', () => {
  it('renders the name', () => {
    render(<Hello name="cloud" />);
    expect(screen.getByText('Hello cloud')).toBeInTheDocument();
  });
});

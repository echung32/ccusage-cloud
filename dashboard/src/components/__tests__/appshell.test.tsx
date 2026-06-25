import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../AppShell';

describe('AppShell scope', () => {
  it('shows Projects and Sessions nav in me scope', () => {
    render(<AppShell active="/overview" scope="me"><div /></AppShell>);
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument();
  });
  it('hides Projects and Sessions nav in group scope', () => {
    render(<AppShell active="/overview" scope="group"><div /></AppShell>);
    expect(screen.queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sessions' })).not.toBeInTheDocument();
  });
  it('renders a me/group toggle as links', () => {
    render(<AppShell active="/overview" scope="me"><div /></AppShell>);
    expect(screen.getByRole('link', { name: /group/i })).toBeInTheDocument();
  });
});

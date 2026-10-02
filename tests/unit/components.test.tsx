// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Container } from '@/components/foundation/Container';
import { StatusBadge } from '@/components/foundation/StatusBadge';

describe('Foundation Components', () => {
  it('renders Container with children and applies custom className', () => {
    render(
      <Container className="custom-class">
        <p>Test Child</p>
      </Container>,
    );

    const child = screen.getByText('Test Child');
    expect(child).toBeInTheDocument();
    expect(child.parentElement).toHaveClass('custom-class');
  });

  it('renders StatusBadge with ready status styles', () => {
    render(<StatusBadge label="System Ready" status="ready" />);

    const badge = screen.getByText('System Ready');
    expect(badge).toBeInTheDocument();
    expect(badge.closest('span')).toHaveClass('text-emerald-400');
  });

  it('renders StatusBadge with pending and active statuses', () => {
    const { rerender } = render(
      <StatusBadge label="Pending Feature" status="pending" />,
    );
    expect(screen.getByText('Pending Feature').closest('span')).toHaveClass(
      'text-amber-400',
    );

    rerender(<StatusBadge label="Active Crawl" status="active" />);
    expect(screen.getByText('Active Crawl').closest('span')).toHaveClass(
      'text-indigo-400',
    );
  });
});

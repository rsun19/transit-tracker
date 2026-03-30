import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { EmptyState } from '../../src/components/ui/EmptyState';

expect.extend(toHaveNoViolations);

describe('EmptyState accessibility', () => {
  it('has no axe violations with message only', async () => {
    const { container } = render(<EmptyState message="No data found" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with action button', async () => {
    const { container } = render(
      <EmptyState
        message="No stops nearby"
        suggestion="Try widening the search area"
        actionLabel="Search wider"
        onAction={() => undefined}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

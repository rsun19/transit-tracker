import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { LoadingSkeleton } from '../../src/components/ui/LoadingSkeleton';
import { EmptyState } from '../../src/components/ui/EmptyState';

expect.extend(toHaveNoViolations);

describe('Accessibility CI gate aggregation', () => {
  it('has no violations for loading placeholders', async () => {
    const { container } = render(<LoadingSkeleton count={3} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations for empty state content and action', async () => {
    const { container } = render(
      <EmptyState
        message="No departures yet"
        suggestion="Try widening the time range"
        actionLabel="Refresh"
        onAction={() => undefined}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

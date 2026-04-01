import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { LoadingSkeleton } from '../../src/components/ui/LoadingSkeleton';

expect.extend(toHaveNoViolations);

describe('LoadingSkeleton accessibility', () => {
  it('has no axe violations with explicit count', async () => {
    const { container } = render(<LoadingSkeleton count={3} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with explicit height and default count', async () => {
    const { container } = render(<LoadingSkeleton height={80} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

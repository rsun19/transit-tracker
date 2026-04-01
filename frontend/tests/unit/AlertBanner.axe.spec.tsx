import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AlertBanner } from '../../src/components/ui/AlertBanner';

expect.extend(toHaveNoViolations);

describe('AlertBanner accessibility', () => {
  it('has no axe violations with warning severity and title', async () => {
    const { container } = render(
      <AlertBanner
        severity="warning"
        title="Service Alert"
        message="Delays on the Red Line due to signal issue"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with error severity', async () => {
    const { container } = render(<AlertBanner severity="error" message="Could not load data" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations using default severity (no props except message)', async () => {
    const { container } = render(<AlertBanner message="Default severity banner" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

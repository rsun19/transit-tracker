import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceAlerts } from '../../src/components/ui/ServiceAlerts';
import type { Alert } from '../../src/lib/api-client';

const alert = (overrides: Partial<Alert>): Alert => ({
  alertId: 'a',
  headerText: 'Header',
  descriptionText: '',
  routeIds: [],
  stopIds: [],
  effect: 'OTHER_EFFECT',
  ...overrides,
});

describe('ServiceAlerts', () => {
  it('renders nothing without alerts', () => {
    const { container } = render(<ServiceAlerts alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows urgent alerts and folds the rest into a collapsed accordion', () => {
    render(
      <ServiceAlerts
        alerts={[
          alert({ alertId: '1', headerText: 'Route 85 delays of 25 minutes', urgent: true }),
          alert({ alertId: '2', headerText: 'Elevator 869 unavailable', urgent: false }),
          alert({ alertId: '3', headerText: 'Parking lot closed', urgent: false }),
        ]}
      />,
    );

    expect(screen.getByText('Route 85 delays of 25 minutes')).toBeVisible();
    const summary = screen.getByRole('button', { name: /other notices \(2\)/i });
    expect(summary).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Elevator 869 unavailable')).toBeInTheDocument();
  });

  it('shows an alert without an urgent flag in full (older API)', () => {
    render(<ServiceAlerts alerts={[alert({ headerText: 'Legacy alert' })]} />);
    expect(screen.getByText('Legacy alert')).toBeVisible();
    expect(screen.queryByRole('button', { name: /other notices/i })).not.toBeInTheDocument();
  });
});

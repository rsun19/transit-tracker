import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import { DepartureRow } from '../../src/components/stops/DepartureRow';
import type { Departure } from '../../src/lib/api-client';

expect.extend(toHaveNoViolations);

const scheduledDeparture: Departure = {
  tripId: 'trip-1',
  routeId: 'Red',
  routeShortName: 'Red',
  routeLongName: 'Red Line',
  headsign: 'Ashmont',
  scheduledDeparture: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  realtimeDelaySeconds: null,
  hasRealtime: false,
  directionId: null,
};

const realtimeDeparture: Departure = {
  ...scheduledDeparture,
  realtimeDelaySeconds: 180,
  hasRealtime: true,
};

// DepartureRow must be rendered inside a table structure for valid HTML / axe
function wrap(row: React.ReactElement) {
  return (
    <Table>
      <TableBody>{row}</TableBody>
    </Table>
  );
}

describe('DepartureRow accessibility', () => {
  it('has no axe violations for scheduled departure', async () => {
    const { container } = render(wrap(<DepartureRow departure={scheduledDeparture} />));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations for real-time departure with delay', async () => {
    const { container } = render(wrap(<DepartureRow departure={realtimeDeparture} />));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

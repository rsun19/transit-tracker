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

const onTimeDeparture: Departure = {
  ...scheduledDeparture,
  realtimeDelaySeconds: 0,
  hasRealtime: true,
};

const lateDeparture: Departure = {
  ...scheduledDeparture,
  realtimeDelaySeconds: 180,
  hasRealtime: true,
};

const earlyDeparture: Departure = {
  ...scheduledDeparture,
  realtimeDelaySeconds: -120,
  hasRealtime: true,
};

// Subway route with no short name (e.g. Red Line in MBTA GTFS)
const subwayDeparture: Departure = {
  ...scheduledDeparture,
  routeShortName: '',
  routeLongName: 'Red Line',
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

  it('has no axe violations for on-time realtime departure', async () => {
    const { container } = render(wrap(<DepartureRow departure={onTimeDeparture} />));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations for late realtime departure', async () => {
    const { container } = render(wrap(<DepartureRow departure={lateDeparture} />));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations for early realtime departure', async () => {
    const { container } = render(wrap(<DepartureRow departure={earlyDeparture} />));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when routeShortName is empty (subway fallback to longName)', async () => {
    const { container } = render(wrap(<DepartureRow departure={subwayDeparture} />));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

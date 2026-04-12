import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import { ArrivalRow } from '../../src/components/stops/ArrivalRow';
import type { Arrival } from '../../src/lib/api-client';

describe('ArrivalRow accessibility', () => {
  expect.extend(toHaveNoViolations);

  const realtimeArrival: Arrival = {
    tripId: 'trip-1',
    routeId: 'Red',
    routeShortName: 'Red',
    routeLongName: 'Red Line',
    headsign: 'Ashmont',
    realtimeArrival: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    realtimeDelaySeconds: null,
    hasRealtime: false,
    directionId: null,
  };

  const onTimeArrival: Arrival = {
    ...realtimeArrival,
    realtimeDelaySeconds: 0,
    hasRealtime: true,
  };

  const lateArrival: Arrival = {
    ...realtimeArrival,
    realtimeDelaySeconds: 180,
    hasRealtime: true,
  };

  const earlyArrival: Arrival = {
    ...realtimeArrival,
    realtimeDelaySeconds: -120,
    hasRealtime: true,
  };

  // Subway route with no short name (e.g. Red Line in MBTA GTFS)
  const subwayArrival: Arrival = {
    ...realtimeArrival,
    routeShortName: '',
    routeLongName: 'Red Line',
  };

  // ArrivalRow must be rendered inside a table structure for valid HTML / axe
  function wrap(row: React.ReactElement) {
    return (
      <Table>
        <TableBody>{row}</TableBody>
      </Table>
    );
  }

  describe('ArrivalRow accessibility', () => {
    it('has no axe violations for scheduled arrival', async () => {
      const { container } = render(wrap(<ArrivalRow arrival={realtimeArrival} />));
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no axe violations for on-time realtime arrival', async () => {
      const { container } = render(wrap(<ArrivalRow arrival={onTimeArrival} />));
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no axe violations for late realtime arrival', async () => {
      const { container } = render(wrap(<ArrivalRow arrival={lateArrival} />));
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no axe violations for early realtime arrival', async () => {
      const { container } = render(wrap(<ArrivalRow arrival={earlyArrival} />));
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
  it('has no axe violations when routeShortName is empty (subway fallback to longName)', async () => {
    const { container } = render(wrap(<ArrivalRow arrival={subwayArrival} />));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

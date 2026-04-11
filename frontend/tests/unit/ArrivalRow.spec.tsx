import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import { ArrivalRow } from '../../src/components/stops/ArrivalRow';
import type { Arrival } from '../../src/lib/api-client';

const BASE: Arrival = {
  tripId: 'trip-1',
  routeId: 'Red',
  routeShortName: 'Red',
  routeLongName: 'Red Line',
  headsign: 'Ashmont',
  scheduledArrival: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  realtimeDelaySeconds: null,
  hasRealtime: false,
  directionId: 1,
};

function wrap(arr: Arrival) {
  return render(
    <Table>
      <TableBody>
        <ArrivalRow arrival={arr} />
      </TableBody>
    </Table>,
  );
}

// --- Route label ---

describe('route chip label', () => {
  it('shows routeShortName when present', () => {
    wrap(BASE);
    expect(screen.getByText('Red')).toBeInTheDocument();
  });

  it('falls back to routeLongName when routeShortName is empty string', () => {
    wrap({ ...BASE, routeShortName: '' });
    expect(screen.getByText('Red Line')).toBeInTheDocument();
  });

  it('falls back to routeLongName when routeShortName is null', () => {
    wrap({ ...BASE, routeShortName: null });
    expect(screen.getByText('Red Line')).toBeInTheDocument();
  });

  it('falls back to routeId when both names are falsy', () => {
    wrap({ ...BASE, routeShortName: null, routeLongName: null });
    expect(screen.getByText('Red')).toBeInTheDocument();
  });
});

describe('scheduled arrival', () => {
  it('shows (scheduled) text', () => {
    wrap(BASE);
    expect(screen.getByText('(scheduled)')).toBeInTheDocument();
  });

  it('does not show On Time, early, or late chips', () => {
    wrap(BASE);
    expect(screen.queryByText(/on time/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/early/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/min$/i)).not.toBeInTheDocument();
  });
});

describe('on-time realtime arrival', () => {
  const arr: Arrival = { ...BASE, hasRealtime: true, realtimeDelaySeconds: 0 };
  it('shows "On Time" chip', () => {
    wrap(arr);
    expect(screen.getByText('On Time')).toBeInTheDocument();
  });
  it('does not show (scheduled)', () => {
    wrap(arr);
    expect(screen.queryByText('(scheduled)')).not.toBeInTheDocument();
  });
});

describe('late realtime arrival', () => {
  const arr: Arrival = { ...BASE, hasRealtime: true, realtimeDelaySeconds: 180 };
  it('shows "+3 min" chip', () => {
    wrap(arr);
    expect(screen.getByText('+3 min')).toBeInTheDocument();
  });
  it('does not show On Time or (scheduled)', () => {
    wrap(arr);
    expect(screen.queryByText('On Time')).not.toBeInTheDocument();
    expect(screen.queryByText('(scheduled)')).not.toBeInTheDocument();
  });
});

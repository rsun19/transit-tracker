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
  realtimeArrival: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
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

describe('time formatting', () => {
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  it('truncates to the minute like mbta.com (8:09:51 shows as 8:09)', () => {
    const at = new Date(2026, 9, 15, 8, 9, 51);
    wrap({ ...BASE, realtimeArrival: at.toISOString() });
    expect(screen.getByText(fmt(new Date(2026, 9, 15, 8, 9)))).toBeInTheDocument();
  });
});

describe('delay threshold', () => {
  it('shows On Time for a delay under 60 s (mbta.com shows no delay)', () => {
    wrap({ ...BASE, hasRealtime: true, realtimeDelaySeconds: 50 });
    expect(screen.getByText('On Time')).toBeInTheDocument();
    expect(screen.queryByText(/\+1 min/)).not.toBeInTheDocument();
  });

  it('shows +1 min from 60 s late', () => {
    wrap({ ...BASE, hasRealtime: true, realtimeDelaySeconds: 70 });
    expect(screen.getByText('+1 min')).toBeInTheDocument();
  });

  it('shows early only from 60 s early', () => {
    wrap({ ...BASE, hasRealtime: true, realtimeDelaySeconds: -45 });
    expect(screen.queryByText(/early/)).not.toBeInTheDocument();
  });
});

describe('boarding and arriving', () => {
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

  it('shows Boarding while the train has arrived but not departed', () => {
    wrap({
      ...BASE,
      hasRealtime: true,
      realtimeDelaySeconds: 0,
      realtimeArrival: iso(-20_000),
      departureTime: iso(40_000),
    });
    expect(screen.getByText('Boarding')).toBeInTheDocument();
  });

  it('shows Arriving within 30 s of arrival', () => {
    wrap({
      ...BASE,
      hasRealtime: true,
      realtimeDelaySeconds: 0,
      realtimeArrival: iso(20_000),
      departureTime: iso(80_000),
    });
    expect(screen.getByText('Arriving')).toBeInTheDocument();
  });

  it('shows the clock time for a scheduled-only row, even when due', () => {
    wrap({ ...BASE, realtimeArrival: iso(-10_000), departureTime: iso(30_000) });
    expect(screen.queryByText('Boarding')).not.toBeInTheDocument();
  });
});

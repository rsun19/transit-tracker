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

function wrap(arr: Arrival, props: { timeZone?: string; now?: number } = {}) {
  return render(
    <Table>
      <TableBody>
        <ArrivalRow arrival={arr} {...props} />
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
  it('truncates to the minute like mbta.com (8:09:51 shows as 8:09)', () => {
    // 12:09:51Z is 8:09:51 AM in Boston (EDT).
    wrap({ ...BASE, realtimeArrival: '2026-10-15T12:09:51.000Z' });
    expect(screen.getByText('8:09 AM')).toBeInTheDocument();
  });

  it('shows the agency timezone, not the device timezone', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      wrap({ ...BASE, realtimeArrival: '2026-10-15T12:42:00.000Z' });
      expect(screen.getByText('8:42 AM')).toBeInTheDocument();
      expect(screen.queryByText('5:42 AM')).not.toBeInTheDocument();
    } finally {
      process.env.TZ = tz;
    }
  });

  it('uses the timezone it is given', () => {
    wrap({ ...BASE, realtimeArrival: '2026-10-15T12:42:00.000Z' }, { timeZone: 'America/Chicago' });
    expect(screen.getByText('7:42 AM')).toBeInTheDocument();
  });

  it('falls back to Boston time for an unknown timezone', () => {
    wrap({ ...BASE, realtimeArrival: '2026-10-15T12:42:00.000Z' }, { timeZone: 'Not/AZone' });
    expect(screen.getByText('8:42 AM')).toBeInTheDocument();
  });
});

describe('server status', () => {
  it('uses status over the delay', () => {
    wrap({ ...BASE, hasRealtime: true, realtimeDelaySeconds: 0, status: 'late' });
    expect(screen.queryByText('On Time')).not.toBeInTheDocument();
  });

  it('shows nothing extra for added trips', () => {
    wrap({ ...BASE, hasRealtime: true, realtimeDelaySeconds: null, status: 'added' });
    expect(screen.queryByText('On Time')).not.toBeInTheDocument();
    expect(screen.queryByText('(scheduled)')).not.toBeInTheDocument();
  });

  it('labels a canceled trip and strikes through its time', () => {
    wrap({
      ...BASE,
      hasRealtime: false,
      status: 'canceled',
      realtimeArrival: '2026-10-15T12:42:00.000Z',
    });
    expect(screen.getByText('Canceled')).toBeInTheDocument();
    expect(screen.getByText('8:42 AM')).toHaveStyle('text-decoration: line-through');
    expect(screen.queryByText('(scheduled)')).not.toBeInTheDocument();
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

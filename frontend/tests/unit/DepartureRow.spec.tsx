import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import { DepartureRow } from '../../src/components/stops/DepartureRow';
import type { Departure } from '../../src/lib/api-client';

const BASE: Departure = {
  tripId: 'trip-1',
  routeId: 'Red',
  routeShortName: 'Red',
  routeLongName: 'Red Line',
  headsign: 'Ashmont',
  scheduledDeparture: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  realtimeDelaySeconds: null,
  hasRealtime: false,
  directionId: 1,
};

function wrap(dep: Departure) {
  return render(
    <Table>
      <TableBody>
        <DepartureRow departure={dep} />
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

// --- Scheduled departure (no realtime) ---

describe('scheduled departure', () => {
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

// --- On-time realtime ---

describe('on-time realtime departure', () => {
  const dep: Departure = { ...BASE, hasRealtime: true, realtimeDelaySeconds: 0 };

  it('shows "On Time" chip', () => {
    wrap(dep);
    expect(screen.getByText('On Time')).toBeInTheDocument();
  });

  it('does not show (scheduled)', () => {
    wrap(dep);
    expect(screen.queryByText('(scheduled)')).not.toBeInTheDocument();
  });
});

// --- Late realtime ---

describe('late realtime departure', () => {
  const dep: Departure = { ...BASE, hasRealtime: true, realtimeDelaySeconds: 180 };

  it('shows "+3 min" chip', () => {
    wrap(dep);
    expect(screen.getByText('+3 min')).toBeInTheDocument();
  });

  it('does not show On Time or (scheduled)', () => {
    wrap(dep);
    expect(screen.queryByText('On Time')).not.toBeInTheDocument();
    expect(screen.queryByText('(scheduled)')).not.toBeInTheDocument();
  });
});

// --- Early realtime ---

describe('early realtime departure', () => {
  const dep: Departure = { ...BASE, hasRealtime: true, realtimeDelaySeconds: -120 };

  it('shows "2 min early" chip', () => {
    wrap(dep);
    expect(screen.getByText('2 min early')).toBeInTheDocument();
  });

  it('does not show On Time, late chip, or (scheduled)', () => {
    wrap(dep);
    expect(screen.queryByText('On Time')).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    expect(screen.queryByText('(scheduled)')).not.toBeInTheDocument();
  });
});

// --- Effective departure time ---

describe('effective departure time', () => {
  it('shows the effective (adjusted) time for a late departure', () => {
    const scheduled = new Date(2026, 3, 3, 12, 0, 0); // 12:00
    const dep: Departure = {
      ...BASE,
      scheduledDeparture: scheduled.toISOString(),
      hasRealtime: true,
      realtimeDelaySeconds: 300, // 5 min late → 12:05
    };
    wrap(dep);
    const effective = new Date(scheduled.getTime() + 300_000);
    const label = effective.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

// --- Headsign ---

describe('headsign', () => {
  it('renders headsign when provided', () => {
    wrap(BASE);
    expect(screen.getByText('Ashmont')).toBeInTheDocument();
  });

  it('renders em-dash when headsign is null', () => {
    wrap({ ...BASE, headsign: null });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import StopArrivalsClient from '../../src/app/stops/[stopId]/StopArrivalsClient';
import { fetchAlerts, fetchStopArrivals, type Arrival } from '../../src/lib/api-client';

jest.mock('../../src/lib/api-client', () => ({
  fetchStopArrivals: jest.fn(),
  fetchAlerts: jest.fn(),
}));

const mockArrivals = fetchStopArrivals as jest.MockedFunction<typeof fetchStopArrivals>;
const mockAlerts = fetchAlerts as jest.MockedFunction<typeof fetchAlerts>;

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const arrival = (overrides: Partial<Arrival>): Arrival => ({
  tripId: 't',
  routeId: '1',
  routeShortName: '1',
  routeLongName: null,
  headsign: 'Harvard',
  realtimeArrival: iso(5 * 60_000),
  realtimeDelaySeconds: null,
  hasRealtime: false,
  directionId: 0,
  ...overrides,
});

function renderClient(initialArrivals: Arrival[]) {
  return render(
    <StopArrivalsClient
      initialArrivals={initialArrivals}
      initialAlerts={[]}
      initialStopName="Mass Ave @ Main St"
      stopId="stop-1"
    />,
  );
}

beforeEach(() => {
  mockAlerts.mockResolvedValue({ alerts: [] });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('StopArrivalsClient', () => {
  it('fetches on mount instead of waiting for the first poll', async () => {
    mockArrivals.mockResolvedValue({
      data: [],
      stopId: 'stop-1',
      agencyKey: 'mbta',
      stopName: 'Mass Ave @ Main St',
    });
    renderClient([]);
    await waitFor(() => expect(mockArrivals).toHaveBeenCalledTimes(1));
  });

  it('does not render a departed vehicle at a one-direction stop', async () => {
    const departed = arrival({
      tripId: 'gone',
      headsign: 'Departed Already',
      realtimeArrival: iso(-120_000),
      departureTime: iso(-60_000),
    });
    const coming = arrival({ tripId: 'next', headsign: 'Still Coming' });
    // Keep the mount fetch pending so only the initial (server) data shows.
    mockArrivals.mockReturnValue(new Promise(() => {}));
    renderClient([departed, coming]);

    expect(screen.getByText('Still Coming')).toBeInTheDocument();
    expect(screen.queryByText('Departed Already')).not.toBeInTheDocument();
  });

  it('shows the empty state when every listed vehicle has departed', () => {
    mockArrivals.mockReturnValue(new Promise(() => {}));
    renderClient([arrival({ realtimeArrival: iso(-120_000), departureTime: iso(-60_000) })]);
    expect(screen.getByText('No upcoming arrivals')).toBeInTheDocument();
  });

  it('shows times in the agency timezone from the response', async () => {
    mockArrivals.mockResolvedValue({
      data: [arrival({ realtimeArrival: '2099-10-15T12:42:00.000Z' })],
      stopId: 'stop-1',
      agencyKey: 'mbta',
      stopName: 'Mass Ave @ Main St',
      timezone: 'America/Chicago',
      feedTimestamp: null,
    });
    renderClient([]);
    expect(await screen.findByText('7:42 AM')).toBeInTheDocument();
  });

  it('shows how fresh the predictions are, and warns when they are stale', async () => {
    const nowS = Date.now() / 1000;
    mockArrivals.mockResolvedValueOnce({
      data: [arrival({ hasRealtime: true })],
      stopId: 'stop-1',
      agencyKey: 'mbta',
      stopName: 'Mass Ave @ Main St',
      timezone: 'America/New_York',
      feedTimestamp: nowS - 20,
    });
    const { unmount } = renderClient([]);
    expect(await screen.findByText(/Live predictions updated 2\d s ago/)).toBeInTheDocument();
    unmount();

    mockArrivals.mockResolvedValueOnce({
      data: [arrival({ hasRealtime: true })],
      stopId: 'stop-1',
      agencyKey: 'mbta',
      stopName: 'Mass Ave @ Main St',
      timezone: 'America/New_York',
      feedTimestamp: nowS - 300,
    });
    renderClient([]);
    expect(
      await screen.findByText(/Live predictions may be out of date \(updated 5 min ago\)/),
    ).toBeInTheDocument();
  });

  it('does not poll while the tab is hidden, and refreshes when it is shown again', async () => {
    jest.useFakeTimers();
    const visibility = jest.spyOn(document, 'visibilityState', 'get');
    try {
      mockArrivals.mockResolvedValue({
        data: [],
        stopId: 'stop-1',
        agencyKey: 'mbta',
        stopName: 'Mass Ave @ Main St',
      });
      visibility.mockReturnValue('hidden');
      renderClient([]);
      expect(mockArrivals).toHaveBeenCalledTimes(1); // mount

      await act(async () => {
        jest.advanceTimersByTime(45_000);
      });
      expect(mockArrivals).toHaveBeenCalledTimes(1);

      visibility.mockReturnValue('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(mockArrivals).toHaveBeenCalledTimes(2);

      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(mockArrivals).toHaveBeenCalledTimes(3);
    } finally {
      visibility.mockRestore();
      jest.useRealTimers();
    }
  });

  it('falls back to Boston time when a later response has no timezone', async () => {
    const at = '2099-10-15T12:42:00.000Z';
    mockArrivals.mockResolvedValueOnce({
      data: [arrival({ realtimeArrival: at })],
      stopId: 'stop-1',
      agencyKey: 'mbta',
      stopName: 'Mass Ave @ Main St',
      timezone: 'America/Chicago',
    });
    jest.useFakeTimers();
    try {
      renderClient([]);
      await act(async () => {});
      expect(screen.getByText('7:42 AM')).toBeInTheDocument();

      mockArrivals.mockResolvedValueOnce({
        data: [arrival({ realtimeArrival: at })],
        stopId: 'stop-1',
        agencyKey: 'mbta',
        stopName: 'Mass Ave @ Main St',
      });
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(screen.getByText('8:42 AM')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a slower, older response that finishes after a newer one', async () => {
    const response = (headsign: string) => ({
      data: [arrival({ headsign })],
      stopId: 'stop-1',
      agencyKey: 'mbta',
      stopName: 'Mass Ave @ Main St',
    });
    let resolveOld!: (v: ReturnType<typeof response>) => void;
    mockArrivals
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r))) // mount: slow
      .mockResolvedValueOnce(response('Newer Data')); // visibility refresh
    renderClient([]);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Newer Data')).toBeInTheDocument();

    await act(async () => {
      resolveOld(response('Older Data'));
    });
    expect(screen.getByText('Newer Data')).toBeInTheDocument();
    expect(screen.queryByText('Older Data')).not.toBeInTheDocument();
  });
});

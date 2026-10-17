'use client';
import { useEffect, useMemo, useState } from 'react';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { fetchStopArrivals, fetchAlerts, type Arrival, type Alert } from '@/lib/api-client';
import { DEFAULT_AGENCY_TIMEZONE, formatAge } from '@/lib/format-time';
import { EmptyState } from '@/components/ui/EmptyState';
import { ServiceAlerts } from '@/components/ui/ServiceAlerts';
import ArrivalTable from './ArrivalTable';

const DEFAULT_AGENCY = 'mbta';
const POLL_INTERVAL_MS = 15_000;
// Predictions older than this get a warning. The worker polls every 15 s and
// drops feeds older than 120 s, so this only shows when ingestion has stalled.
const STALE_FEED_S = 120;
const DIRECTION_LABELS: Record<number, string> = {
  0: 'Outbound',
  1: 'Inbound',
};

type StopArrivalsClientProps = {
  initialArrivals: Arrival[];
  initialAlerts: Alert[];
  initialStopName: string;
  stopId: string;
};

export default function StopArrivalsClient({
  initialArrivals,
  initialAlerts,
  initialStopName,
  stopId,
}: StopArrivalsClientProps) {
  const [arrivals, setArrivals] = useState<Arrival[]>(initialArrivals);
  const [stopName, setStopName] = useState<string>(initialStopName);
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [error, setError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(DEFAULT_AGENCY_TIMEZONE);
  const [feedTimestamp, setFeedTimestamp] = useState<number | null>(null);

  // Track current time so filtering is always up-to-date
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let isMounted = true;
    const fetchArrivals = async () => {
      try {
        const [arrData, alertsData] = await Promise.all([
          fetchStopArrivals(stopId, DEFAULT_AGENCY),
          fetchAlerts({ stopId, agencyKey: DEFAULT_AGENCY }),
        ]);
        if (!isMounted) return;
        // Sort arrivals by .realtimeArrival ascending before setting state
        const sortedArrivals = [...arrData.data].sort((a, b) => {
          const tA = new Date(a.realtimeArrival).getTime();
          const tB = new Date(b.realtimeArrival).getTime();
          return tA - tB;
        });
        setArrivals(sortedArrivals);
        setStopName(arrData.stopName || stopId);
        if (arrData.timezone) setTimeZone(arrData.timezone);
        setFeedTimestamp(arrData.feedTimestamp ?? null);
        setAlerts(alertsData.alerts);
        setError(null);
      } catch (err: unknown) {
        if (!isMounted) return;
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      }
    };
    // Fetch right away (the server-rendered data may already be a poll old),
    // then every 15 s while the tab is visible, and again when it comes back.
    const isVisible = () => document.visibilityState !== 'hidden';
    fetchArrivals();
    const interval = setInterval(() => {
      if (isVisible()) fetchArrivals();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (isVisible()) fetchArrivals();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      isMounted = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [stopId]);

  // Tick every second so departed rows drop off, "Boarding"/"Arriving" switch
  // on time, and the feed age stays current between polls.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Drop arrivals whose vehicle has already left. A train that has arrived
  // but not departed is still boarding and stays listed.
  const filteredArrivals = useMemo(() => {
    return arrivals.filter((arr) => {
      const leaves = new Date(arr.departureTime ?? arr.realtimeArrival).getTime();
      return leaves >= now;
    });
  }, [arrivals, now]);

  const directionGroups = useMemo(() => {
    const groups = new Map<number | null, Arrival[]>();
    for (const arr of filteredArrivals) {
      const key = arr.directionId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(arr);
    }
    // Sort groups: 1 (Inbound) before 0 (Outbound) before null
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a; // 1 before 0
    });
  }, [filteredArrivals]);

  const isGrouped = directionGroups.length > 1;
  const feedAgeS = feedTimestamp !== null ? Math.max(0, now / 1000 - feedTimestamp) : null;
  const isFeedStale = feedAgeS !== null && feedAgeS > STALE_FEED_S;
  const displayName = stopName || stopId;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" href="/stops" sx={{ cursor: 'pointer' }}>
          Stops
        </Link>
        <Typography color="text.primary">{displayName}</Typography>
      </Breadcrumbs>

      <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
        {displayName}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upcoming arrivals
        {feedAgeS !== null && (
          <Box
            component="span"
            sx={{ display: 'block', color: isFeedStale ? 'warning.main' : 'text.secondary' }}
          >
            {isFeedStale
              ? `Live predictions may be out of date (updated ${formatAge(feedAgeS)})`
              : `Live predictions updated ${formatAge(feedAgeS)}`}
          </Box>
        )}
      </Typography>

      {error && <EmptyState message="Could not load arrivals" suggestion={error} />}
      {!error && <ServiceAlerts alerts={alerts} />}
      {!error && filteredArrivals.length === 0 && (
        <EmptyState
          message="No upcoming arrivals"
          suggestion="There are no scheduled arrivals for this stop right now."
        />
      )}
      {!error && filteredArrivals.length > 0 && !isGrouped && (
        <ArrivalTable
          title="All Arrivals"
          arrivals={filteredArrivals}
          timeZone={timeZone}
          now={now}
        />
      )}
      {!error && filteredArrivals.length > 0 && isGrouped && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {directionGroups.map(([dirId, arrivals], idx) => {
            const label =
              dirId !== null ? (DIRECTION_LABELS[dirId] ?? `Direction ${dirId}`) : 'All Arrivals';
            const anchor = dirId !== null ? `dir-${dirId}` : 'dir-all';
            const others = directionGroups
              .map(([od], oi) => ({ dirId: od, index: oi }))
              .filter(({ index }) => index !== idx);
            return (
              <Box key={dirId ?? 'all'} id={anchor} sx={{ scrollMarginTop: '1rem' }}>
                {others.map(({ dirId: otherDirId, index: otherIdx }) => {
                  const otherLabel =
                    otherDirId !== null
                      ? (DIRECTION_LABELS[otherDirId] ?? `Direction ${otherDirId}`)
                      : 'All Arrivals';
                  const otherAnchor = otherDirId !== null ? `dir-${otherDirId}` : 'dir-all';
                  const arrow = otherIdx > idx ? '↓' : '↑';
                  return (
                    <Link
                      key={otherDirId ?? 'all'}
                      href={`#${otherAnchor}`}
                      underline="hover"
                      sx={{
                        display: 'inline-block',
                        mb: 1,
                        fontSize: '0.8rem',
                        color: 'text.secondary',
                      }}
                    >
                      {arrow} Jump to {otherLabel}
                    </Link>
                  );
                })}
                <ArrivalTable title={label} arrivals={arrivals} timeZone={timeZone} now={now} />
              </Box>
            );
          })}
        </Box>
      )}
    </Container>
  );
}

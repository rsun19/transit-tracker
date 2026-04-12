'use client';
import { useEffect, useMemo, useState } from 'react';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { fetchStopArrivals, fetchAlerts, type Arrival, type Alert } from '@/lib/api-client';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertBanner } from '@/components/ui/AlertBanner';
import ArrivalTable from './ArrivalTable';

const DEFAULT_AGENCY = 'mbta';
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

  useEffect(() => {
    let isMounted = true;
    const fetchArrivals = async () => {
      try {
        const [arrData, alertsData] = await Promise.all([
          fetchStopArrivals(stopId, DEFAULT_AGENCY),
          fetchAlerts({ stopId, agencyKey: DEFAULT_AGENCY }),
        ]);
        if (!isMounted) return;
        setArrivals(arrData.data);
        setStopName(arrData.stopName || stopId);
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
    const interval = setInterval(fetchArrivals, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [stopId]);

  const directionGroups = useMemo(() => {
    const groups = new Map<number | null, Arrival[]>();
    for (const arr of arrivals) {
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
  }, [arrivals]);

  const isGrouped = directionGroups.length > 1;
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
      </Typography>

      {error && <EmptyState message="Could not load arrivals" suggestion={error} />}
      {!error && alerts.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {alerts.map((alert) => (
            <AlertBanner
              key={alert.alertId}
              severity="warning"
              title={alert.headerText}
              message={alert.descriptionText}
            />
          ))}
        </Box>
      )}
      {!error && arrivals.length === 0 && (
        <EmptyState
          message="No upcoming arrivals"
          suggestion="There are no scheduled arrivals for this stop right now."
        />
      )}
      {!error && arrivals.length > 0 && !isGrouped && (
        <ArrivalTable title="All Arrivals" arrivals={arrivals} />
      )}
      {!error && arrivals.length > 0 && isGrouped && (
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
                <ArrivalTable title={label} arrivals={arrivals} />
              </Box>
            );
          })}
        </Box>
      )}
    </Container>
  );
}

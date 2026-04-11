'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import Paper from '@mui/material/Paper';
import { fetchStopArrivals, fetchAlerts, type Arrival, type Alert } from '@/lib/api-client';
import { ArrivalRow } from '@/components/stops/ArrivalRow';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertBanner } from '@/components/ui/AlertBanner';

const DEFAULT_AGENCY = 'mbta';

const DIRECTION_LABELS: Record<number, string> = {
  0: 'Outbound',
  1: 'Inbound',
};

function ArrivalTable({ title, deps }: { title: string; deps: Arrival[] }) {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label={`${title} arrival schedule`}>
          <TableHead>
            <TableRow>
              <TableCell>Route</TableCell>
              <TableCell>Destination</TableCell>
              <TableCell>Arrives</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {deps.map((dep, i) => (
              <ArrivalRow key={`${dep.routeId}-${dep.scheduledArrival}-${i}`} arrival={dep} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default function StopArrivalsPage() {
  const params = useParams();
  const stopId = decodeURIComponent((params?.stopId as string) ?? '');

  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [stopName, setStopName] = useState<string>('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stopId) return;
    setLoading(true);
    Promise.all([
      fetchStopArrivals(stopId, DEFAULT_AGENCY),
      fetchAlerts({ stopId, agencyKey: DEFAULT_AGENCY }),
    ])
      .then(([arrData, alertsData]) => {
        setArrivals(arrData.data);
        setStopName(arrData.stopName || stopId);
        setAlerts(alertsData.alerts);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [stopId]);

  // Group arrivals by directionId. If all share the same direction (or null),
  // render a single table; otherwise render one table per direction side-by-side.
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

      {loading && <LoadingSkeleton count={6} />}

      {!loading && error && <EmptyState message="Could not load arrivals" suggestion={error} />}

      {!loading && !error && alerts.length > 0 && (
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

      {!loading && !error && arrivals.length === 0 && (
        <EmptyState
          message="No upcoming arrivals"
          suggestion="There are no scheduled arrivals for this stop right now."
        />
      )}

      {!loading && !error && arrivals.length > 0 && !isGrouped && (
        <ArrivalTable title="All Arrivals" deps={arrivals} />
      )}

      {!loading && !error && arrivals.length > 0 && isGrouped && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {directionGroups.map(([dirId, deps], idx) => {
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
                <ArrivalTable title={label} deps={deps} />
              </Box>
            );
          })}
        </Box>
      )}
    </Container>
  );
}

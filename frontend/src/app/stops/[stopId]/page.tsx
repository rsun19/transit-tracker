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
import { fetchStopDepartures, fetchAlerts, type Departure, type Alert } from '@/lib/api-client';
import { DepartureRow } from '@/components/stops/DepartureRow';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertBanner } from '@/components/ui/AlertBanner';

const DEFAULT_AGENCY = 'mbta';

const DIRECTION_LABELS: Record<number, string> = {
  0: 'Outbound',
  1: 'Inbound',
};

function DepartureTable({ title, deps }: { title: string; deps: Departure[] }) {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label={`${title} departure schedule`}>
          <TableHead>
            <TableRow>
              <TableCell>Route</TableCell>
              <TableCell>Destination</TableCell>
              <TableCell>Departs</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {deps.map((dep, i) => (
              <DepartureRow key={`${dep.routeId}-${dep.scheduledDeparture}-${i}`} departure={dep} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default function StopDeparturesPage() {
  const params = useParams();
  const stopId = decodeURIComponent((params?.stopId as string) ?? '');

  const [departures, setDepartures] = useState<Departure[]>([]);
  const [stopName, setStopName] = useState<string>('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stopId) return;
    setLoading(true);
    Promise.all([
      fetchStopDepartures(stopId, DEFAULT_AGENCY),
      fetchAlerts({ stopId, agencyKey: DEFAULT_AGENCY }),
    ])
      .then(([depData, alertsData]) => {
        setDepartures(depData.data);
        setStopName(depData.stopName || stopId);
        setAlerts(alertsData.alerts);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [stopId]);

  // Group departures by directionId. If all share the same direction (or null),
  // render a single table; otherwise render one table per direction side-by-side.
  const directionGroups = useMemo(() => {
    const groups = new Map<number | null, Departure[]>();
    for (const dep of departures) {
      const key = dep.directionId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(dep);
    }
    // Sort groups: 1 (Inbound) before 0 (Outbound) before null
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a; // 1 before 0
    });
  }, [departures]);

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
        Upcoming departures
      </Typography>

      {loading && <LoadingSkeleton count={6} />}

      {!loading && error && <EmptyState message="Could not load departures" suggestion={error} />}

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

      {!loading && !error && departures.length === 0 && (
        <EmptyState
          message="No upcoming departures"
          suggestion="There are no scheduled departures for this stop right now."
        />
      )}

      {!loading && !error && departures.length > 0 && !isGrouped && (
        <DepartureTable title="All Departures" deps={departures} />
      )}

      {!loading && !error && departures.length > 0 && isGrouped && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {directionGroups.map(([dirId, deps]) => {
            const label =
              dirId !== null ? (DIRECTION_LABELS[dirId] ?? `Direction ${dirId}`) : 'All Departures';
            return <DepartureTable key={dirId ?? 'all'} title={label} deps={deps} />;
          })}
        </Box>
      )}
    </Container>
  );
}

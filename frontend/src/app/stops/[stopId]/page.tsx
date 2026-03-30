'use client';

import { useEffect, useState } from 'react';
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
import {
  fetchStopDepartures,
  fetchStopRoutes,
  fetchAlerts,
  type Departure,
  type Alert,
} from '@/lib/api-client';
import { DepartureRow } from '@/components/stops/DepartureRow';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertBanner } from '@/components/ui/AlertBanner';

const DEFAULT_AGENCY = 'mbta';

export default function StopDeparturesPage() {
  const params = useParams();
  const stopId = decodeURIComponent(params?.stopId as string ?? '');

  const [departures, setDepartures] = useState<Departure[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stopId) return;
    setLoading(true);
    Promise.all([
      fetchStopDepartures(stopId, DEFAULT_AGENCY),
      fetchStopRoutes(stopId, DEFAULT_AGENCY),
      fetchAlerts({ stopId, agencyKey: DEFAULT_AGENCY }),
    ])
      .then(([depData, routesData, alertsData]) => {
        setDepartures(depData.data);
        void routesData;
        setAlerts(alertsData.alerts);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [stopId]);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" href="/stops" sx={{ cursor: 'pointer' }}>
          Stops
        </Link>
        <Typography color="text.primary">{stopId}</Typography>
      </Breadcrumbs>

      <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
        {stopId}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upcoming departures
      </Typography>

      {loading && <LoadingSkeleton count={6} />}

      {!loading && error && (
        <EmptyState message="Could not load departures" suggestion={error} />
      )}

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

      {!loading && !error && departures.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Departure schedule">
            <TableHead>
              <TableRow>
                <TableCell>Route</TableCell>
                <TableCell>Destination</TableCell>
                <TableCell>Departs</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {departures.map((dep, i) => (
                <DepartureRow key={`${dep.routeId}-${dep.scheduledDeparture}-${i}`} departure={dep} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}

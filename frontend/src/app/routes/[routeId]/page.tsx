'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { fetchRoute, fetchAlerts, type Route, type Alert } from '@/lib/api-client';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertBanner } from '@/components/ui/AlertBanner';

// For now assume the first agency — in a multi-agency setup this would be a query param
const DEFAULT_AGENCY = 'mbta';

export default function RouteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const routeId = decodeURIComponent((params?.routeId as string) ?? '');

  const [route, setRoute] = useState<Route | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeId) return;
    setLoading(true);
    Promise.all([
      fetchRoute(routeId, DEFAULT_AGENCY),
      fetchAlerts({ routeId, agencyKey: DEFAULT_AGENCY }),
    ])
      .then(([routeData, alertsData]) => {
        setRoute(routeData);
        setAlerts(alertsData.alerts);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [routeId]);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" href="/" sx={{ cursor: 'pointer' }}>
          Routes
        </Link>
        <Typography color="text.primary">{routeId}</Typography>
      </Breadcrumbs>

      {loading && <LoadingSkeleton count={8} />}

      {!loading && error && <EmptyState message="Could not load route" suggestion={error} />}

      {!loading && !error && !route && (
        <EmptyState
          message="Route not found"
          suggestion="The route may have been removed or the ID is incorrect"
        />
      )}

      {!loading && !error && route && (
        <>
          {alerts.length > 0 && (
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

          <Box sx={{ mb: 3 }}>
            <Typography variant="h5" fontWeight={700}>
              {route.shortName && `${route.shortName} — `}
              {route.longName}
            </Typography>
          </Box>

          <Typography variant="h6" gutterBottom>
            Stops
          </Typography>

          {(route as Route & { stops?: { stopId: string; stopName: string }[] }).stops?.length ===
          0 ? (
            <EmptyState message="No stops found for this route" />
          ) : (
            <List disablePadding>
              {(
                (route as Route & { stops?: { stopId: string; stopName: string }[] }).stops ?? []
              ).map((stop) => (
                <ListItem key={stop.stopId} disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => router.push(`/stops/${encodeURIComponent(stop.stopId)}`)}
                    sx={{ borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                  >
                    <ListItemText primary={stop.stopName} secondary={stop.stopId} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </>
      )}
    </Container>
  );
}

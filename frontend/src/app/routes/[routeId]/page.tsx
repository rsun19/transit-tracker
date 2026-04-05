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
import Grid from '@mui/material/Grid';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import {
  fetchRoute,
  fetchAlerts,
  type Route,
  type RouteBranch,
  type Alert,
} from '@/lib/api-client';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertBanner } from '@/components/ui/AlertBanner';

const DEFAULT_AGENCY = 'mbta';

function StopList({
  stops,
  routerId,
}: {
  stops: RouteBranch['stops'];
  routerId: ReturnType<typeof useRouter>;
}) {
  if (stops.length === 0) return <EmptyState message="No stops found for this branch" />;
  return (
    <List disablePadding>
      {stops.map((stop) => (
        <ListItem key={stop.stopId} disablePadding sx={{ mb: 0.5 }}>
          <ListItemButton
            onClick={() => routerId.push(`/stops/${encodeURIComponent(stop.stopId)}`)}
            sx={{ borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
          >
            <ListItemText primary={stop.stopName} secondary={stop.stopId} />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
}

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

  const branches = route?.branches ?? [];

  // Compute shared trunk stops and per-branch unique tails.
  //
  // True branching (e.g. Red Line: two dir=0 branches Ashmont + Braintree):
  //   → shared trunk shown as a flat list, then one column per branch tail.
  // Simple inbound/outbound (e.g. Orange, Blue): subway stops have distinct
  //   stop IDs per platform/direction so intersection is near-empty. Just show
  //   the outbound (dir=0) branch as a single canonical flat list.
  let sharedStops: RouteBranch['stops'] = route?.stops ?? [];
  let branchSections: { label: string; stops: RouteBranch['stops'] }[] = [];

  const canonical = branches.filter((b) => b.directionId === 0);

  if (canonical.length >= 2) {
    // True branching (e.g. Red Line: Ashmont + Braintree). Use only dir=0 branches
    // to compute the shared trunk and per-branch unique tails.
    const stopIdSets = canonical.map((b) => new Set(b.stops.map((s) => s.stopId)));
    const trunkIds = stopIdSets.reduce((acc, set) => new Set([...acc].filter((id) => set.has(id))));
    const longestBranch = [...canonical].sort((a, b) => b.stops.length - a.stops.length)[0];
    sharedStops = longestBranch.stops.filter((s) => trunkIds.has(s.stopId));
    branchSections = canonical
      .map((b) => ({ label: b.label, stops: b.stops.filter((s) => !trunkIds.has(s.stopId)) }))
      .filter((s) => s.stops.length > 0);
  } else {
    // Simple inbound/outbound (e.g. Orange, Blue, Silver Line): subway platforms have
    // different stop IDs per direction so set-intersection produces near-empty trunks.
    // Just show the outbound (dir=0) branch as a canonical flat list.
    const representativeBranch =
      canonical[0] ?? [...branches].sort((a, b) => b.stops.length - a.stops.length)[0];
    sharedStops = representativeBranch?.stops ?? [];
    branchSections = [];
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
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

          {sharedStops.length === 0 && branchSections.length === 0 ? (
            <EmptyState message="No stops found for this route" />
          ) : (
            <>
              {sharedStops.length > 0 && <StopList stops={sharedStops} routerId={router} />}
              {branchSections.length > 0 && (
                <Grid container spacing={3} sx={{ mt: sharedStops.length > 0 ? 2 : 0 }}>
                  {branchSections.map((section) => (
                    <Grid key={section.label} item xs={12} md={6}>
                      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                        {section.label}
                      </Typography>
                      <StopList stops={section.stops} routerId={router} />
                    </Grid>
                  ))}
                </Grid>
              )}
            </>
          )}
        </>
      )}
    </Container>
  );
}

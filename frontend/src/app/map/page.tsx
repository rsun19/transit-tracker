'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo } from 'react';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import { usePolling } from '@/lib/hooks/usePolling';
import {
  fetchVehicles,
  fetchAlerts,
  type Vehicle,
  type Alert as TransitAlert,
} from '@/lib/api-client';

const VehicleMap = dynamic(
  () => import('@/components/map/VehicleMap').then((m) => ({ default: m.VehicleMap })),
  {
    ssr: false,
    loading: () => <Skeleton variant="rectangular" width="100%" height="100%" />,
  },
);

const DEFAULT_AGENCY = 'mbta';
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export default function MapPage() {
  const vehicleFetcher = useCallback(
    () => fetchVehicles(DEFAULT_AGENCY).then((res) => res.data.flatMap((a) => a.vehicles)),
    [],
  );

  const alertFetcher = useCallback(
    () => fetchAlerts({ agencyKey: DEFAULT_AGENCY }).then((r) => r.alerts),
    [],
  );

  const {
    data: vehicles,
    error: vehicleError,
    isLoading: vehicleLoading,
    lastUpdatedAt: vehicleUpdatedAt,
  } = usePolling<Vehicle[]>(15_000, vehicleFetcher);

  const { data: alerts } = usePolling<TransitAlert[]>(30_000, alertFetcher);

  const isStale =
    vehicleUpdatedAt != null && Date.now() - vehicleUpdatedAt.getTime() > STALE_THRESHOLD_MS;

  const displayedVehicles = useMemo(() => vehicles ?? [], [vehicles]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <Container maxWidth={false} sx={{ py: 2, flexShrink: 0 }}>
        <Typography variant="h5" fontWeight={700}>
          Live Vehicle Map
        </Typography>
        {vehicleUpdatedAt && (
          <Typography variant="caption" color="text.secondary">
            Last updated {vehicleUpdatedAt.toLocaleTimeString()}
          </Typography>
        )}
      </Container>

      {isStale && (
        <Box sx={{ px: 2, flexShrink: 0 }}>
          <Alert severity="warning">Live updates paused — data may be older than 5 minutes</Alert>
        </Box>
      )}

      {(alerts ?? [])
        .filter((a) => !a.routeIds.length && !a.stopIds.length)
        .map((alert) => (
          <Box key={alert.alertId} sx={{ px: 2, flexShrink: 0 }}>
            <Alert severity="warning" title={alert.headerText}>
              {alert.descriptionText}
            </Alert>
          </Box>
        ))}

      <Box sx={{ flex: 1, position: 'relative' }}>
        {vehicleLoading && !vehicles ? (
          <Skeleton variant="rectangular" width="100%" height="100%" />
        ) : (
          <VehicleMap vehicles={displayedVehicles} error={vehicleError} />
        )}
      </Box>
    </Box>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { fetchNearbyStops, fetchAlerts, type Stop, type Alert as TransitAlert } from '@/lib/api-client';
import { StopCard } from '@/components/stops/StopCard';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertBanner } from '@/components/ui/AlertBanner';

const DEFAULT_AGENCY = 'mbta';
const DEFAULT_RADIUS_M = 500;

export default function NearbyStopsPage() {
  const router = useRouter();
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M);
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [useManual, setUseManual] = useState(false);
  const [stops, setStops] = useState<Stop[]>([]);
  const [alerts, setAlerts] = useState<TransitAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doFetch = useCallback(
    async (searchLat: number, searchLon: number, searchRadius: number) => {
      setLoading(true);
      setFetchError(null);
      try {
        const [nearbyData, alertsData] = await Promise.all([
          fetchNearbyStops(searchLat, searchLon, searchRadius, DEFAULT_AGENCY),
          fetchAlerts({ agencyKey: DEFAULT_AGENCY }),
        ]);
        setStops(nearbyData.data);
        setAlerts(alertsData.alerts);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch nearby stops');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by this browser');
      setUseManual(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLon(pos.coords.longitude);
      },
      () => {
        setGeoError('Location access was denied');
        setUseManual(true);
      },
    );
  }, []);

  // Fetch when coords change or radius changes
  useEffect(() => {
    if (lat === null || lon === null) return;
    doFetch(lat, lon, radius);

    // Poll every 30s for departure refresh
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => doFetch(lat, lon, radius), 30_000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [lat, lon, radius, doFetch]);

  function handleManualSearch() {
    const parsedLat = parseFloat(manualLat);
    const parsedLon = parseFloat(manualLon);
    if (isNaN(parsedLat) || isNaN(parsedLon)) return;
    if (parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) return;
    setLat(parsedLat);
    setLon(parsedLon);
    setUseManual(false);
  }

  function widenSearch() {
    setRadius((r) => Math.min(r * 2, 5000));
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Nearby Stops
      </Typography>

      {geoError && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {geoError}. Enter your location manually below.
        </Alert>
      )}

      {useManual && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <TextField
            label="Latitude"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            size="small"
            inputProps={{ inputMode: 'decimal', 'aria-label': 'Latitude' }}
            sx={{ width: 160 }}
          />
          <TextField
            label="Longitude"
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
            size="small"
            inputProps={{ inputMode: 'decimal', 'aria-label': 'Longitude' }}
            sx={{ width: 160 }}
          />
          <Button
            variant="contained"
            startIcon={<MyLocationIcon />}
            onClick={handleManualSearch}
          >
            Search
          </Button>
        </Box>
      )}

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

      {loading && <LoadingSkeleton count={5} />}

      {!loading && !lat && !useManual && (
        <EmptyState message="Getting your location…" suggestion="Please allow location access in your browser" />
      )}

      {!loading && fetchError && (
        <EmptyState message="Could not load nearby stops" suggestion={fetchError} />
      )}

      {!loading && !fetchError && stops.length === 0 && lat !== null && (
        <EmptyState
          message="No stops nearby"
          suggestion={`No stops found within ${radius}m. Try widening the search area.`}
          onAction={widenSearch}
          actionLabel="Search wider area"
        />
      )}

      {!loading && !fetchError && stops.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Found {stops.length} stop{stops.length !== 1 ? 's' : ''} within {radius}m
          </Typography>
          <List disablePadding sx={{ mb: 2 }}>
            {stops.map((stop) => (
              <ListItem key={stop.stopId} disablePadding sx={{ mb: 1 }}>
                <StopCard
                  stop={stop}
                  onClick={() => router.push(`/stops/${encodeURIComponent(stop.stopId)}`)}
                />
              </ListItem>
            ))}
          </List>
          {radius < 5000 && (
            <Button variant="outlined" onClick={widenSearch}>
              Search wider area
            </Button>
          )}
        </>
      )}
    </Container>
  );
}

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import SearchIcon from '@mui/icons-material/Search';
import { fetchStops, fetchNearbyStops, type Stop } from '@/lib/api-client';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';

const DEFAULT_AGENCY = 'mbta';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function StopsPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(true);
  const [geoDenied, setGeoDenied] = useState(false);
  const [nearbyStops, setNearbyStops] = useState<Stop[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Request geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoLoading(false);
      },
      () => {
        setGeoDenied(true);
        setGeoLoading(false);
      },
    );
  }, []);

  const isSearching = debouncedQuery.trim().length >= 2;

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setStops([]);
      setSearched(false);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    setLoading(true);
    try {
      const data = await fetchStops({ q: q.trim(), agencyKey: DEFAULT_AGENCY }, signal);
      setStops(data.data);
      setSearched(true);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setStops([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search(debouncedQuery);
  }, [debouncedQuery, search]);

  // Fetch nearby stops when not searching and coords are available
  useEffect(() => {
    if (isSearching || !userCoords) return;
    setNearbyLoading(true);
    fetchNearbyStops(userCoords.lat, userCoords.lon, undefined, DEFAULT_AGENCY)
      .then((res) => setNearbyStops(res.data))
      .catch(() => setNearbyStops([]))
      .finally(() => setNearbyLoading(false));
  }, [isSearching, userCoords]);

  const isNearbyMode = !isSearching && !!userCoords;
  const activeLoading = isSearching ? loading : isNearbyMode ? nearbyLoading : geoLoading;
  const activeStops = isSearching ? stops : nearbyStops;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        {isNearbyMode ? 'Nearby Stops' : 'Find a Stop'}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {isNearbyMode ? 'Stops closest to your location' : 'Search by stop name or code'}
      </Typography>

      <TextField
        fullWidth
        placeholder="e.g. Park Street, Silver Line Way"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 3 }}
        aria-label="Stop search"
      />

      {activeLoading && <LoadingSkeleton count={6} />}

      {!activeLoading && !isSearching && !isNearbyMode && geoDenied && (
        <EmptyState
          message="Location access is blocked"
          suggestion="Enable location in your browser settings to see nearby stops, or type to search by name."
        />
      )}

      {!activeLoading && !isSearching && !isNearbyMode && !geoDenied && (
        <EmptyState
          message="Type to search"
          suggestion="Enter at least 2 characters to find stops"
        />
      )}

      {!activeLoading && isSearching && searched && stops.length === 0 && (
        <EmptyState
          message="No stops found"
          suggestion={`No stops matched "${query}". Try a different name or code.`}
        />
      )}

      {!activeLoading && isNearbyMode && nearbyStops.length === 0 && (
        <EmptyState
          message="No nearby stops found"
          suggestion="Try searching by name or code instead"
        />
      )}

      {!activeLoading && activeStops.length > 0 && (
        <List disablePadding>
          {activeStops.map((stop) => (
            <ListItem key={stop.stopId} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                onClick={() => router.push(`/stops/${encodeURIComponent(stop.stopId)}`)}
                sx={{ borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
              >
                <ListItemText
                  primary={stop.stopName}
                  secondary={
                    <Stack component="span" direction="column" spacing={0.5}>
                      <span>{stop.stopCode ? `Stop #${stop.stopCode}` : stop.stopId}</span>
                      {stop.distanceMetres !== undefined && (
                        <span>
                          {stop.distanceMetres < 1000
                            ? `${Math.round(stop.distanceMetres)}m away`
                            : `${(stop.distanceMetres / 1000).toFixed(1)}km away`}
                        </span>
                      )}
                      {stop.routes && stop.routes.length > 0 && (
                        <Stack component="span" direction="row" spacing={0.5} flexWrap="wrap">
                          {Array.from(new Map(stop.routes.map((r) => [r.routeId, r])).values()).map(
                            (r) => (
                              <Chip
                                key={r.routeId}
                                label={r.shortName || r.longName || r.routeId}
                                size="small"
                                variant="outlined"
                              />
                            ),
                          )}
                        </Stack>
                      )}
                    </Stack>
                  }
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </Container>
  );
}

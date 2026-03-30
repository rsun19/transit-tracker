'use client';

import { useState, useCallback, useEffect } from 'react';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { useRouter } from 'next/navigation';
import { fetchRoutes, type Route } from '@/lib/api-client';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';

const ROUTE_TYPE_LABELS: Record<number, string> = {
  0: 'Tram',
  1: 'Subway',
  2: 'Rail',
  3: 'Bus',
  4: 'Ferry',
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const debouncedQuery = useDebounce(query, 300);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const result = await fetchRoutes({ q: q || undefined, limit: 50 });
      setRoutes(result.data);
      setTotal(result.total);
    } catch (err: unknown) {
      setError((err as Error).message);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void search(debouncedQuery);
  }, [debouncedQuery, search]);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Transit Tracker
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Search for routes by name or number
      </Typography>

      <TextField
        fullWidth
        variant="outlined"
        placeholder="Search routes (e.g. Red Line, 39, Silver)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ my: 2 }}
        inputProps={{ 'aria-label': 'Search routes' }}
      />

      {loading && <LoadingSkeleton count={5} />}

      {!loading && error && (
        <EmptyState
          message="Failed to load routes"
          suggestion={error}
          actionLabel="Retry"
          onAction={() => void search(debouncedQuery)}
        />
      )}

      {!loading && !error && searched && routes.length === 0 && (
        <EmptyState
          message={query ? `No routes found for "${query}"` : 'No routes in database'}
          suggestion={
            query
              ? 'Try a different search term'
              : 'Routes will appear after GTFS data has been ingested'
          }
        />
      )}

      {!loading && !error && routes.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            {total} route{total !== 1 ? 's' : ''} found
          </Typography>
          <List disablePadding>
            {routes.map((route) => (
              <ListItem key={route.id} disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton
                  onClick={() => router.push(`/routes/${encodeURIComponent(route.routeId)}`)}
                  sx={{ borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                >
                  {route.color && (
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        bgcolor: `#${route.color}`,
                        mr: 1.5,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {route.shortName && (
                          <Typography variant="subtitle2" fontWeight={700}>
                            {route.shortName}
                          </Typography>
                        )}
                        <Typography variant="body2">{route.longName}</Typography>
                      </Box>
                    }
                  />
                  <Chip
                    label={ROUTE_TYPE_LABELS[route.routeType] ?? `Type ${route.routeType}`}
                    size="small"
                    variant="outlined"
                    sx={{ ml: 1 }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Container>
  );
}

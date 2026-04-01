'use client';

import { useEffect, useState, useCallback } from 'react';
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
import { fetchStops, type Stop } from '@/lib/api-client';
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
  const debouncedQuery = useDebounce(query, 300);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setStops([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchStops({ q: q.trim(), agencyKey: DEFAULT_AGENCY });
      setStops(data.data);
      setSearched(true);
    } catch {
      setStops([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search(debouncedQuery);
  }, [debouncedQuery, search]);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Find a Stop
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Search by stop name or code
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

      {loading && <LoadingSkeleton count={6} />}

      {!loading && !searched && query.trim().length < 2 && (
        <EmptyState
          message="Type to search"
          suggestion="Enter at least 2 characters to find stops"
        />
      )}

      {!loading && searched && stops.length === 0 && (
        <EmptyState
          message="No stops found"
          suggestion={`No stops matched "${query}". Try a different name or code.`}
        />
      )}

      {!loading && stops.length > 0 && (
        <List disablePadding>
          {stops.map((stop) => (
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
                      {stop.routes && stop.routes.length > 0 && (
                        <Stack component="span" direction="row" spacing={0.5} flexWrap="wrap">
                          {stop.routes.map((r) => (
                            <Chip
                              key={r.routeId}
                              label={r.shortName ?? r.longName ?? r.routeId}
                              size="small"
                              variant="outlined"
                            />
                          ))}
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

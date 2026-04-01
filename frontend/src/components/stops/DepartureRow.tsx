'use client';

import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { Departure } from '@/lib/api-client';

interface DepartureRowProps {
  departure: Departure;
}

function formatTime(isoString: string): string {
  try {
    // Backend sends ISO timestamps in UTC (converted from agency's timezone).
    // toLocaleTimeString() automatically converts to the browser's local timezone.
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    /* istanbul ignore next */
  } catch {
    return isoString;
  }
}

export function DepartureRow({ departure }: DepartureRowProps) {
  const hasDelay =
    departure.hasRealtime &&
    departure.realtimeDelaySeconds !== null &&
    departure.realtimeDelaySeconds !== 0;

  return (
    <TableRow hover>
      <TableCell>
        <Chip
          label={departure.routeShortName ?? departure.routeId}
          size="small"
          color="primary"
          variant="outlined"
        />
      </TableCell>
      <TableCell>
        <Typography variant="body2">{departure.headsign ?? '—'}</Typography>
      </TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2">{formatTime(departure.scheduledDeparture)}</Typography>
          {hasDelay && (
            <Chip
              label={`+${Math.round((departure.realtimeDelaySeconds ?? 0) / 60)} min`}
              size="small"
              color="warning"
            />
          )}
          {!departure.hasRealtime && (
            <Typography variant="caption" color="text.secondary">
              (scheduled)
            </Typography>
          )}
        </Box>
      </TableCell>
    </TableRow>
  );
}

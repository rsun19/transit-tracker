'use client';

import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
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
  const delay = departure.realtimeDelaySeconds;
  const delayMinutes = delay !== null ? Math.round(delay / 60) : 0;

  const isLate = departure.hasRealtime && delay !== null && delayMinutes > 0;
  const isEarly = departure.hasRealtime && delay !== null && delayMinutes < 0;
  const isOnTime = departure.hasRealtime && delay !== null && delayMinutes === 0;

  // Show effective departure time (scheduled + delay) when realtime data is available
  const effectiveIso =
    departure.hasRealtime && delay !== null
      ? new Date(new Date(departure.scheduledDeparture).getTime() + delay * 1000).toISOString()
      : departure.scheduledDeparture;

  const timeColor = isLate
    ? 'error.main'
    : isEarly
      ? 'warning.main'
      : isOnTime
        ? 'success.main'
        : 'text.primary';

  // Prefer short name, fall back to long name (e.g. "Red Line"), then route ID
  const routeLabel = departure.routeShortName || departure.routeLongName || departure.routeId;

  return (
    <TableRow hover>
      <TableCell>
        <Chip label={routeLabel} size="small" color="primary" variant="outlined" />
      </TableCell>
      <TableCell>
        <Typography variant="body2">{departure.headsign ?? '—'}</Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ color: timeColor }}>
          {formatTime(effectiveIso)}
        </Typography>
      </TableCell>
      <TableCell>
        {isLate && <Chip label={`+${delayMinutes} min`} size="small" color="error" />}
        {isEarly && (
          <Chip label={`${Math.abs(delayMinutes)} min early`} size="small" color="warning" />
        )}
        {isOnTime && <Chip label="On Time" size="small" color="success" variant="outlined" />}
        {!departure.hasRealtime && (
          <Typography variant="caption" color="text.secondary">
            (scheduled)
          </Typography>
        )}
      </TableCell>
    </TableRow>
  );
}

'use client';

import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { Arrival } from '@/lib/api-client';

interface ArrivalRowProps {
  arrival: Arrival;
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
export function ArrivalRow({ arrival }: ArrivalRowProps) {
  const delay = arrival.realtimeDelaySeconds;
  const delayMinutes = delay !== null ? Math.round(delay / 60) : 0;

  const isLate = arrival.hasRealtime && delay !== null && delayMinutes > 0;
  const isEarly = arrival.hasRealtime && delay !== null && delayMinutes < 0;
  const isOnTime = arrival.hasRealtime && delay !== null && delayMinutes === 0;

  // Show effective arrival time (scheduled + delay) when realtime data is available
  const effectiveIso =
    arrival.hasRealtime && delay !== null
      ? new Date(new Date(arrival.scheduledArrival).getTime() + delay * 1000).toISOString()
      : arrival.scheduledArrival;

  const timeColor = isLate
    ? 'error.main'
    : isEarly
      ? 'warning.main'
      : isOnTime
        ? 'success.main'
        : 'text.primary';

  // Prefer short name, fall back to long name (e.g. "Red Line"), then route ID
  const routeLabel = arrival.routeShortName || arrival.routeLongName || arrival.routeId;

  return (
    <TableRow hover>
      <TableCell>
        <Chip label={routeLabel} size="small" color="primary" variant="outlined" />
      </TableCell>
      <TableCell>
        <Typography variant="body2">{arrival.headsign ?? '—'}</Typography>
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
        {!arrival.hasRealtime && (
          <Typography variant="caption" color="text.secondary">
            (scheduled)
          </Typography>
        )}
      </TableCell>
    </TableRow>
  );
}

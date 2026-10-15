'use client';

import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { Arrival } from '@/lib/api-client';

interface ArrivalRowProps {
  arrival: Arrival;
}

// Same thresholds as mbta.com (mbta/dotcom upcoming_departures/processor.ex):
// a delay or early arrival is only shown at 60 s or more, and a train
// arriving within 30 s is "Arriving".
const DELAY_THRESHOLD_S = 60;
const ARRIVING_WITHIN_MS = 30_000;

export function ArrivalRow({ arrival }: ArrivalRowProps) {
  const delay = arrival.realtimeDelaySeconds;
  const delayMinutes = delay !== null ? Math.round(delay / 60) : 0;

  const isLate = arrival.hasRealtime && delay !== null && delay >= DELAY_THRESHOLD_S;
  const isEarly = arrival.hasRealtime && delay !== null && delay <= -DELAY_THRESHOLD_S;
  const isOnTime = arrival.hasRealtime && delay !== null && !isLate && !isEarly;

  // Use realtimeArrival directly (already computed by backend)
  const effectiveIso = arrival.realtimeArrival;
  // Format as local time string (HH:MM). toLocaleTimeString truncates the
  // seconds, which is what mbta.com does for clock times.
  let formattedTime = effectiveIso;
  try {
    formattedTime = new Date(effectiveIso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    // If parsing fails, fall back to the ISO string
  }

  // A predicted train that has arrived but not left is boarding.
  if (arrival.hasRealtime) {
    const now = Date.now();
    const arrivesAt = new Date(effectiveIso).getTime();
    const leavesAt = new Date(arrival.departureTime ?? effectiveIso).getTime();
    if (arrivesAt <= now && now <= leavesAt) formattedTime = 'Boarding';
    else if (arrivesAt > now && arrivesAt - now <= ARRIVING_WITHIN_MS) formattedTime = 'Arriving';
  }

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
          {formattedTime}
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

'use client';

import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { Arrival, ArrivalStatus } from '@/lib/api-client';
import { DEFAULT_AGENCY_TIMEZONE, formatClockTime } from '@/lib/format-time';

interface ArrivalRowProps {
  arrival: Arrival;
  /** Agency timezone the time is shown in. */
  timeZone?: string;
  /** Current time (ms); passed down so every row ticks together. */
  now?: number;
}

// Same thresholds as mbta.com (mbta/dotcom upcoming_departures/processor.ex):
// a delay or early arrival is only shown at 60 s or more, and a train
// arriving within 30 s is "Arriving".
const DELAY_THRESHOLD_S = 60;
const ARRIVING_WITHIN_MS = 30_000;

/** The server's status; derived from the delay for responses that predate it. */
function arrivalStatus(arrival: Arrival): ArrivalStatus {
  if (arrival.status) return arrival.status;
  const delay = arrival.realtimeDelaySeconds;
  if (!arrival.hasRealtime) return 'scheduled';
  if (delay === null) return 'added';
  if (delay >= DELAY_THRESHOLD_S) return 'late';
  if (delay <= -DELAY_THRESHOLD_S) return 'early';
  return 'on_time';
}

export function ArrivalRow({
  arrival,
  timeZone = DEFAULT_AGENCY_TIMEZONE,
  now = Date.now(),
}: ArrivalRowProps) {
  const status = arrivalStatus(arrival);
  const delayMinutes = Math.round((arrival.realtimeDelaySeconds ?? 0) / 60);
  const isLate = status === 'late';
  const isEarly = status === 'early';
  const isOnTime = status === 'on_time';
  const isCanceled = status === 'canceled';

  // realtimeArrival is the prediction if there is one, else the schedule.
  const effectiveIso = arrival.realtimeArrival;
  let formattedTime = formatClockTime(effectiveIso, timeZone);

  // A predicted train that has arrived but not left is boarding.
  if (arrival.hasRealtime && !isCanceled) {
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
        <Typography
          variant="body2"
          sx={{
            color: timeColor,
            textDecoration: isCanceled ? 'line-through' : undefined,
          }}
        >
          {formattedTime}
        </Typography>
      </TableCell>
      <TableCell>
        {isLate && <Chip label={`+${delayMinutes} min`} size="small" color="error" />}
        {isEarly && (
          <Chip label={`${Math.abs(delayMinutes)} min early`} size="small" color="warning" />
        )}
        {isOnTime && <Chip label="On Time" size="small" color="success" variant="outlined" />}
        {isCanceled && <Chip label="Canceled" size="small" color="default" />}
        {status === 'scheduled' && (
          <Typography variant="caption" color="text.secondary">
            (scheduled)
          </Typography>
        )}
      </TableCell>
    </TableRow>
  );
}

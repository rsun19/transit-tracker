'use client';

import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { Arrival } from '@/lib/api-client';

interface ArrivalRowProps {
  arrival: Arrival;
}

import { useEffect, useState } from 'react';

function useHydratedTime(isoString: string): string {
  const [localTime, setLocalTime] = useState<string>(isoString);
  useEffect(() => {
    try {
      setLocalTime(
        new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      );
    } catch {
      setLocalTime(isoString);
    }
  }, [isoString]);
  return localTime;
}
export function ArrivalRow({ arrival }: ArrivalRowProps) {
  const delay = arrival.realtimeDelaySeconds;
  const delayMinutes = delay !== null ? Math.round(delay / 60) : 0;

  const isLate = arrival.hasRealtime && delay !== null && delayMinutes > 0;
  const isEarly = arrival.hasRealtime && delay !== null && delayMinutes < 0;
  const isOnTime = arrival.hasRealtime && delay !== null && delayMinutes === 0;

  // Use realtimeArrival directly (already computed by backend)
  const effectiveIso = arrival.realtimeArrival;

  const timeColor = isLate
    ? 'error.main'
    : isEarly
      ? 'warning.main'
      : isOnTime
        ? 'success.main'
        : 'text.primary';

  // Prefer short name, fall back to long name (e.g. "Red Line"), then route ID
  const routeLabel = arrival.routeShortName || arrival.routeLongName || arrival.routeId;

  const hydratedTime = useHydratedTime(effectiveIso);
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
          {hydratedTime}
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

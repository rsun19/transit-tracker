import { ArrivalRow } from '@/components/stops/ArrivalRow';
import { Arrival } from '@/lib/api-client';
import {
  Box,
  Typography,
  TableContainer,
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from '@mui/material';

type ArrivalTableProps = {
  title: string;
  arrivals: Arrival[];
  /** Agency timezone the times are shown in. */
  timeZone?: string;
  now?: number;
};

const ArrivalTable = ({ title, arrivals, timeZone, now }: ArrivalTableProps) => {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label={`${title} arrival schedule`}>
          <TableHead>
            <TableRow>
              <TableCell>Route</TableCell>
              <TableCell>Destination</TableCell>
              <TableCell>Arrives</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {arrivals.map((arr, i) => (
              <ArrivalRow
                key={`${arr.routeId}-${arr.realtimeArrival ?? arr.tripId}-${i}`}
                arrival={arr}
                timeZone={timeZone}
                now={now}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default ArrivalTable;

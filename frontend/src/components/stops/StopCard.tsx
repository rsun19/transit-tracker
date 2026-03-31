'use client';

import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { Stop } from '@/lib/api-client';

interface StopCardProps {
  stop: Stop;
  onClick?: () => void;
}

export function StopCard({ stop, onClick }: StopCardProps) {
  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardActionArea onClick={onClick}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                {stop.stopName}
              </Typography>
              {stop.stopCode && (
                <Typography variant="body2" color="text.secondary">
                  Stop #{stop.stopCode}
                </Typography>
              )}
            </Box>
            {stop.distanceMetres !== undefined && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 1, whiteSpace: 'nowrap' }}
              >
                {stop.distanceMetres < 1000
                  ? `${stop.distanceMetres} m`
                  : `${(stop.distanceMetres / 1000).toFixed(1)} km`}
              </Typography>
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

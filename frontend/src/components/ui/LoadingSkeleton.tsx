'use client';

import Skeleton from '@mui/material/Skeleton';
import Box from '@mui/material/Box';

interface LoadingSkeletonProps {
  height?: number;
  count?: number;
}

export function LoadingSkeleton({ height = 60, count = 3 }: LoadingSkeletonProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="rectangular" height={height} sx={{ borderRadius: 1 }} />
      ))}
    </Box>
  );
}

'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

interface EmptyStateProps {
  message: string;
  suggestion?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ message, suggestion, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        px: 2,
        textAlign: 'center',
        gap: 2,
      }}
    >
      <Typography variant="h6" color="text.secondary">
        {message}
      </Typography>
      {suggestion && (
        <Typography variant="body2" color="text.secondary">
          {suggestion}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button variant="outlined" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}

'use client';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';

interface AlertBannerProps {
  severity?: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  message: string;
  action?: React.ReactNode;
}

export function AlertBanner({ severity = 'warning', title, message, action }: AlertBannerProps) {
  return (
    <Alert severity={severity} action={action} sx={{ mb: 2 }}>
      {title && <AlertTitle>{title}</AlertTitle>}
      {message}
    </Alert>
  );
}

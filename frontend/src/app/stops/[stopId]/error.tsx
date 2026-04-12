'use client';

import { Button } from '@mui/material';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <p className="text-destructive">Failed to load arrivals: {error.message}</p>
      <Button onClick={reset} className="underline">
        Try again
      </Button>
    </div>
  );
}

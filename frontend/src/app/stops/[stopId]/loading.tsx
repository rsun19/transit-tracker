import CircularProgress from '@mui/material/CircularProgress';

export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <CircularProgress color="primary" />
      <p className="text-muted-foreground">Loading arrivals...</p>
    </div>
  );
}

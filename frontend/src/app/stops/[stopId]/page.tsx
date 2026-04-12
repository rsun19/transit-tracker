import dynamic from 'next/dynamic';
import { fetchStopArrivals, fetchAlerts } from '@/lib/api-client';

const StopArrivalsClient = dynamic(() => import('./StopArrivalsClient'), { ssr: false });

const DEFAULT_AGENCY = 'mbta';

type ServerProps = { params: { stopId: string } };

export default async function StopArrivalsPage({ params }: ServerProps) {
  const stopId = decodeURIComponent(params.stopId);

  try {
    const [arrData, alertsData] = await Promise.all([
      fetchStopArrivals(stopId, DEFAULT_AGENCY),
      fetchAlerts({ stopId, agencyKey: DEFAULT_AGENCY }),
    ]);
    return (
      <StopArrivalsClient
        initialArrivals={arrData.data}
        initialAlerts={alertsData.alerts}
        initialStopName={arrData.stopName || stopId}
        stopId={stopId}
      />
    );
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new Error(err.message ?? 'Failed to fetch stop data');
    }
    throw new Error('Failed to fetch stop data');
  }
}

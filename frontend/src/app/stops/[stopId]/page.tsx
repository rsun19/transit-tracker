import dynamic from 'next/dynamic';
import { fetchStopArrivals, fetchAlerts, fetchStopRouteIds } from '@/lib/api-client';

const StopArrivalsClient = dynamic(() => import('./StopArrivalsClient'), { ssr: false });

const DEFAULT_AGENCY = 'mbta';

type ServerProps = { params: { stopId: string } };

export default async function StopArrivalsPage({ params }: ServerProps) {
  const stopId = decodeURIComponent(params.stopId);

  try {
    // Routes serving the stop (cached for a day) let the alerts include
    // line-wide ones, e.g. "Red Line: delays of about 20 minutes".
    const [arrData, routeIds] = await Promise.all([
      fetchStopArrivals(stopId, DEFAULT_AGENCY),
      fetchStopRouteIds(stopId, DEFAULT_AGENCY).catch(() => [] as string[]),
    ]);
    const alertsData = await fetchAlerts({ stopId, routeIds, agencyKey: DEFAULT_AGENCY });
    return (
      <StopArrivalsClient
        initialArrivals={arrData.data}
        initialAlerts={alertsData.alerts}
        initialStopName={arrData.stopName || stopId}
        stopId={stopId}
        routeIds={routeIds}
      />
    );
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new Error(err.message ?? 'Failed to fetch stop data');
    }
    throw new Error('Failed to fetch stop data');
  }
}

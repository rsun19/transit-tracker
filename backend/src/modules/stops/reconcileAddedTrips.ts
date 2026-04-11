import { ArrivalResponse, AddedTripEntry } from './stops.types';

const RECONCILE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function reconcileAddedTrips(
  arrivals: ArrivalResponse[],
  addedEntries: AddedTripEntry[],
): ArrivalResponse[] {
  const sorted = [...addedEntries].sort((a, b) => a.arrivalTime - b.arrivalTime);
  const reconciledIndices = new Set<number>();

  for (const entry of sorted) {
    const addedMs = entry.arrivalTime * 1000;

    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < arrivals.length; i++) {
      if (reconciledIndices.has(i)) continue;
      const arr = arrivals[i];
      if (arr.routeId !== entry.trip.routeId) continue;
      if (arr.directionId !== entry.trip.directionId) continue;
      const diff = Math.abs(addedMs - new Date(arr.scheduledArrival).getTime());
      if (diff < bestDiff && diff <= RECONCILE_WINDOW_MS) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      reconciledIndices.add(bestIdx);
      const schedMs = new Date(arrivals[bestIdx].scheduledArrival).getTime();
      arrivals[bestIdx].realtimeDelaySeconds = Math.round((addedMs - schedMs) / 1000);
      arrivals[bestIdx].hasRealtime = true;
      if (!arrivals[bestIdx].headsign) {
        arrivals[bestIdx].headsign = entry.trip.headsign ?? entry.headsignFallback;
      }
    } else {
      arrivals.push({
        tripId: entry.trip.tripId,
        routeId: entry.trip.routeId,
        routeShortName: entry.routeShortName,
        routeLongName: entry.routeLongName,
        headsign: entry.trip.headsign ?? entry.headsignFallback,
        scheduledArrival: new Date(addedMs).toISOString(),
        realtimeDelaySeconds: 0,
        hasRealtime: true,
        directionId: entry.trip.directionId,
      });
      // Prevent subsequent ADDED entries from matching this newly-pushed row.
      reconciledIndices.add(arrivals.length - 1);
    }
  }

  return arrivals;
}

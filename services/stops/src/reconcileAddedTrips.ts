const MAX_MATCH_DIFF_MS = 5 * 60 * 1000;
import { ArrivalResponse, AddedTripEntry } from './stops.types';

export function reconcileAddedTrips(
  arrivals: ArrivalResponse[],
  addedEntries: AddedTripEntry[],
): ArrivalResponse[] {
  arrivals.sort(
    (a, b) => new Date(a.realtimeArrival).getTime() - new Date(b.realtimeArrival).getTime(),
  );
  const sorted = [...addedEntries].sort((a, b) => a.arrivalTime - b.arrivalTime);
  const reconciledIndices = new Set<number>();

  for (const entry of sorted) {
    const addedMs = entry.arrivalTime * 1000;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < arrivals.length; i++) {
      if (reconciledIndices.has(i)) continue;
      const arr = arrivals[i];
      if (arr.hasRealtime) continue;
      if (arr.routeId !== entry.trip.routeId) continue;
      if (arr.directionId !== entry.trip.directionId) continue;
      const schedMs = new Date(arr.realtimeArrival).getTime();
      const diff = Math.abs(addedMs - schedMs);
      if (diff < bestDiff && diff <= MAX_MATCH_DIFF_MS) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      reconciledIndices.add(bestIdx);
      const schedMs = new Date(arrivals[bestIdx].realtimeArrival).getTime();
      arrivals[bestIdx].realtimeArrival = new Date(addedMs).toISOString();
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
        realtimeArrival: new Date(addedMs).toISOString(),
        realtimeDelaySeconds: 0,
        hasRealtime: true,
        directionId: entry.trip.directionId,
      });
      reconciledIndices.add(arrivals.length - 1);
    }
  }
  return arrivals;
}

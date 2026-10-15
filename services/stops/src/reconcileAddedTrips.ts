import { applyPrediction, type MergedArrival } from './merge-realtime';
import { AddedTripEntry } from './stops.types';

export const RECONCILE_WINDOW_S = 5 * 60;

// GTFS route_type 0 (light rail) and 1 (subway). MBTA publishes predictions
// for some scheduled subway trips under ADDED trip_ids; on bus and commuter
// rail an ADDED trip is real extra service and must not hide a scheduled one.
const isSubway = (routeType: number | null) => routeType === 0 || routeType === 1;

/**
 * Folds ADDED trips into the arrivals list. On subway, an ADDED trip takes
 * over the closest unpredicted scheduled trip on the same route and direction
 * within RECONCILE_WINDOW_S (one-to-one). Everything else is appended as
 * extra service.
 */
export function reconcileAddedTrips(
  arrivals: MergedArrival[],
  addedEntries: AddedTripEntry[],
): MergedArrival[] {
  // Ascending order, so on frequent routes each ADDED trip claims its
  // closest slot before later ones are considered.
  const sorted = [...addedEntries].sort((a, b) => a.predictedTime - b.predictedTime);
  const reconciledIndices = new Set<number>();

  for (const entry of sorted) {
    let bestIdx = -1;
    let bestDiff = Infinity;
    if (isSubway(entry.routeType)) {
      for (let i = 0; i < arrivals.length; i++) {
        if (reconciledIndices.has(i)) continue;
        const arr = arrivals[i];
        // A passed row is about to be filtered out; claiming it would hide the ADDED trip.
        if (arr.hasRealtime || arr.passed || arr.status !== 'scheduled') continue;
        if (arr.scheduledEpoch === null) continue;
        if (arr.routeId !== entry.trip.routeId) continue;
        if (arr.directionId !== entry.trip.directionId) continue;
        const diff = Math.abs(entry.predictedTime - arr.scheduledEpoch);
        if (diff < bestDiff && diff <= RECONCILE_WINDOW_S) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
    }

    if (bestIdx !== -1) {
      reconciledIndices.add(bestIdx);
      const arr = arrivals[bestIdx];
      applyPrediction(
        arr,
        entry.predictedTime,
        entry.predictedTime - arr.scheduledEpoch!,
        entry.uncertaintySeconds,
        entry.leavesAt,
      );
      if (!arr.headsign) arr.headsign = entry.trip.headsign ?? entry.headsignFallback;
    } else {
      const extra: MergedArrival = {
        tripId: entry.trip.tripId,
        routeId: entry.trip.routeId,
        routeShortName: entry.routeShortName,
        routeLongName: entry.routeLongName,
        headsign: entry.trip.headsign ?? entry.headsignFallback,
        directionId: entry.trip.directionId,
        realtimeArrival: '',
        realtimeDelaySeconds: null,
        hasRealtime: false,
        scheduledTime: null,
        predictedTime: null,
        status: 'added',
        uncertaintySeconds: null,
        effectiveTime: entry.predictedTime,
        leavesAt: entry.leavesAt,
        scheduledEpoch: null,
        serviceDate: null,
        routeType: entry.routeType,
        pickupType: null,
        passed: false,
      };
      applyPrediction(extra, entry.predictedTime, null, entry.uncertaintySeconds, entry.leavesAt);
      arrivals.push(extra);
      reconciledIndices.add(arrivals.length - 1);
    }
  }
  return arrivals;
}

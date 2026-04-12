import { StopResponse, StopRouteRef } from './stops.types';

/** Radius in degrees used to consider two bus stops as co-located (~150 m). */
export const STOP_MERGE_RADIUS_DEG = 150 / 111_320;

/**
 * Merge co-located bus stops in a search result list.
 *
 * Two stops are merged when they share the same `stopName`, are within
 * `STOP_MERGE_RADIUS_DEG` of each other, AND share at least one route.
 * The first stop in each group is kept as the canonical entry; its route list
 * becomes the union of all merged stops' routes (deduped by routeId).
 */
export function mergeColocatedStops(stops: StopResponse[]): StopResponse[] {
  const merged: StopResponse[] = [];
  const consumed = new Set<string>();

  for (const stop of stops) {
    if (consumed.has(stop.stopId)) continue;
    const stopRouteIds = new Set((stop.routes ?? []).map((r: StopRouteRef) => r.routeId));

    const group = stops.filter((other: StopResponse) => {
      if (other.stopId === stop.stopId) return true;
      if (consumed.has(other.stopId)) return false;
      if (other.stopName !== stop.stopName) return false;
      const dLat = other.lat - stop.lat;
      const dLon = other.lon - stop.lon;
      if (Math.sqrt(dLat * dLat + dLon * dLon) > STOP_MERGE_RADIUS_DEG) return false;
      return (other.routes ?? []).some((r: StopRouteRef) => stopRouteIds.has(r.routeId));
    });

    const seenRouteIds = new Set<string>();
    const mergedRoutes: StopRouteRef[] = [];
    for (const g of group) {
      for (const r of g.routes ?? []) {
        const route: StopRouteRef = r;
        if (!seenRouteIds.has(route.routeId)) {
          seenRouteIds.add(route.routeId);
          mergedRoutes.push(route);
        }
      }
    }
    mergedRoutes.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? ''));
    for (const g of group) consumed.add(g.stopId);
    merged.push({ ...stop, routes: mergedRoutes });
  }

  return merged;
}

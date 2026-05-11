import { StopResponse, StopRouteRef } from './stops.types';

export const STOP_MERGE_RADIUS_DEG = 150 / 111_320;

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

import { STOP_MERGE_RADIUS_DEG } from '@transit-tracker/shared';

export type StopPoint = { stopId: string; stopName: string; lat: number; lon: number };

/**
 * Groups top-level stops that are the same place: same name, within
 * STOP_MERGE_RADIUS_DEG (longitude scaled by latitude), and sharing a route.
 * Returns stop_id -> group id (the first stop's id) for stops in a group of
 * two or more; stops on their own aren't in the map.
 */
export function colocatedGroups(
  stops: StopPoint[],
  routesByStop: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string> {
  const consumed = new Set<string>();
  const groups = new Map<string, string>();

  for (const stop of stops) {
    if (consumed.has(stop.stopId)) continue;
    consumed.add(stop.stopId);
    const stopRoutes = routesByStop.get(stop.stopId) ?? new Set<string>();

    const group = [stop.stopId];
    for (const other of stops) {
      if (consumed.has(other.stopId) || other.stopName !== stop.stopName) continue;
      const dLat = other.lat - stop.lat;
      const meanLatRad = ((stop.lat + other.lat) / 2) * (Math.PI / 180);
      const dLon = (other.lon - stop.lon) * Math.cos(meanLatRad);
      if (Math.sqrt(dLat * dLat + dLon * dLon) > STOP_MERGE_RADIUS_DEG) continue;
      const otherRoutes = routesByStop.get(other.stopId);
      if (!otherRoutes || ![...stopRoutes].some((r) => otherRoutes.has(r))) continue;
      group.push(other.stopId);
      consumed.add(other.stopId);
    }

    if (group.length > 1) for (const id of group) groups.set(id, stop.stopId);
  }
  return groups;
}

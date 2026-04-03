const API_BASE = '/api/v1';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- Types ---

export interface RouteStop {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
  stopSequence: number;
}

export interface RouteBranch {
  label: string;
  directionId: number;
  stops: RouteStop[];
}

export interface Route {
  id: string;
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number;
  color: string | null;
  textColor: string | null;
  stops?: RouteStop[];
  branches?: RouteBranch[];
  shape?: GeoJsonLineString | null;
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface StopRouteRef {
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number;
}

export interface Stop {
  id: string;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  wheelchairBoarding: number | null;
  distanceMetres?: number;
  nextDeparture?: Departure | null;
  routes?: StopRouteRef[];
}

export interface Departure {
  tripId: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  headsign: string | null;
  scheduledDeparture: string;
  realtimeDelaySeconds: number | null;
  hasRealtime: boolean;
  directionId: number | null;
}

export interface Trip {
  tripId: string;
  routeId: string;
  headsign: string | null;
  stops: TripStop[];
}

export interface TripStop {
  sequence: number;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
}

export interface Vehicle {
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed: number | null;
  label: string | null;
  updatedAt: string;
}

export interface Alert {
  alertId: string;
  headerText: string;
  descriptionText: string;
  routeIds: string[];
  stopIds: string[];
  effect: string;
}

export interface Agency {
  key: string;
  displayName: string;
  timezone: string;
  hasRealtime: boolean;
  lastIngestedAt: string | null;
}

// --- Fetch wrappers ---

export function fetchRoutes(params?: {
  agencyKey?: string;
  routeType?: number;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: Route[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.agencyKey) qs.set('agencyKey', params.agencyKey);
  if (params?.routeType !== undefined) qs.set('routeType', String(params.routeType));
  if (params?.q) qs.set('q', params.q);
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.offset !== undefined) qs.set('offset', String(params.offset));
  return apiFetch<{ data: Route[]; total: number }>(`/routes?${qs}`);
}

export function fetchRoute(routeId: string, agencyKey: string): Promise<Route> {
  return apiFetch<Route>(
    `/routes/${encodeURIComponent(routeId)}?agencyKey=${encodeURIComponent(agencyKey)}`,
  );
}

export function fetchStops(params?: {
  q?: string;
  agencyKey?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: Stop[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.agencyKey) qs.set('agencyKey', params.agencyKey);
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.offset !== undefined) qs.set('offset', String(params.offset));
  return apiFetch<{ data: Stop[]; total: number }>(`/stops?${qs}`);
}

export function fetchStopDepartures(
  stopId: string,
  agencyKey: string,
  params?: { limit?: number; after?: string },
): Promise<{ data: Departure[]; stopId: string; agencyKey: string; stopName: string }> {
  const qs = new URLSearchParams({ agencyKey });
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.after) qs.set('after', params.after);
  return apiFetch<{ data: Departure[]; stopId: string; agencyKey: string; stopName: string }>(
    `/stops/${encodeURIComponent(stopId)}/departures?${qs}`,
  );
}

export function fetchStopRoutes(
  stopId: string,
  agencyKey: string,
): Promise<{
  data: { routeId: string; shortName: string | null; longName: string | null; routeType: number }[];
}> {
  return apiFetch(
    `/stops/${encodeURIComponent(stopId)}/routes?agencyKey=${encodeURIComponent(agencyKey)}`,
  );
}

export function fetchTrip(tripId: string, agencyKey: string): Promise<Trip> {
  return apiFetch<Trip>(
    `/trips/${encodeURIComponent(tripId)}?agencyKey=${encodeURIComponent(agencyKey)}`,
  );
}

export function fetchVehicles(
  agencyKey?: string,
): Promise<{ data: { agencyKey: string; vehicles: Vehicle[] }[] }> {
  const qs = agencyKey ? `?agencyKey=${encodeURIComponent(agencyKey)}` : '';
  return apiFetch(`/vehicles/live${qs}`);
}

export function fetchAlerts(params?: {
  agencyKey?: string;
  routeId?: string;
  stopId?: string;
}): Promise<{ alerts: Alert[] }> {
  const qs = new URLSearchParams();
  if (params?.agencyKey) qs.set('agencyKey', params.agencyKey);
  if (params?.routeId) qs.set('routeId', params.routeId);
  if (params?.stopId) qs.set('stopId', params.stopId);
  return apiFetch<{ alerts: Alert[] }>(`/alerts?${qs}`);
}

export function fetchNearbyStops(
  lat: number,
  lon: number,
  radius?: number,
  agencyKey?: string,
): Promise<{ data: Stop[]; searchCentre: { lat: number; lon: number }; radiusMetres: number }> {
  const qs = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (radius !== undefined) qs.set('radius', String(radius));
  if (agencyKey) qs.set('agencyKey', agencyKey);
  return apiFetch(`/stops/nearby?${qs}`);
}

export function fetchAgencies(): Promise<{ data: Agency[] }> {
  return apiFetch<{ data: Agency[] }>('/agencies');
}

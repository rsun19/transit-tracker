export type AddedTrip = {
  tripId: string;
  routeId: string;
  directionId: number | null;
  headsign: string | null;
  stops: AddedTripStop[];
};
export interface StopRouteRef {
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number;
}

export interface StopResponse {
  id: string;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  wheelchairBoarding: number | null;
  distanceMetres?: number;
  routes?: StopRouteRef[];
}

export interface ArrivalResponse {
  tripId: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  headsign: string | null;
  scheduledArrival: string;
  realtimeDelaySeconds: number | null;
  hasRealtime: boolean;
  directionId: number | null;
}

export interface AddedTripEntry {
  trip: {
    tripId: string;
    routeId: string;
    directionId: number | null;
    headsign: string | null;
  };
  arrivalTime: number; // Unix seconds
  routeShortName: string | null;
  routeLongName: string | null;
  headsignFallback: string | null;
}

export interface AddedTripStop {
  stopId: string;
  arrivalTime: number; // Unix timestamp (seconds)
}

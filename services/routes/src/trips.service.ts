import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  API_CACHE_TRIP_TTL_S,
  ARRIVALS_LATE_WINDOW_S,
  activeServicesCte,
  candidateServiceDates,
  gtfsTimestampSql,
} from '@transit-tracker/shared';
import { CacheService } from '@transit-tracker/shared/nest';

export interface TripStopResponse {
  sequence: number;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  scheduledArrival: string | null;
  realtimeArrival: string | null;
  scheduledDeparture: string | null;
}

export interface TripDetailResponse {
  tripId: string;
  /** YYYYMMDD service day the times are expanded for. */
  serviceDate: string;
  routeId: string;
  headsign: string | null;
  stops: TripStopResponse[];
}

/** YYYYMMDD → YYYY-MM-DD; null if it isn't a real calendar date. */
export function parseServiceDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Picks the service day a trip is running on now. Yesterday's run wins while
 * it may still be on the road (its last stop is within the late window),
 * otherwise today's; with neither active, today is used for display.
 */
export function pickServiceDate(
  runs: Array<{ d: string; lastStopEpoch: number | null }>,
  today: string,
  yesterday: string,
  nowS: number,
): string {
  const y = runs.find((r) => r.d === yesterday);
  if (y && y.lastStopEpoch !== null && y.lastStopEpoch >= nowS - ARRIVALS_LATE_WINDOW_S) {
    return yesterday;
  }
  if (runs.some((r) => r.d === today)) return today;
  return y ? yesterday : today;
}

const isoFromEpoch = (epochS: number | null) =>
  epochS === null ? null : new Date(epochS * 1000).toISOString();

@Injectable()
export class TripsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  /** `serviceDate` is YYYY-MM-DD; when omitted, the day the trip is running now. */
  async findOne(
    tripId: string,
    agencyKey: string,
    serviceDate?: string,
  ): Promise<TripDetailResponse> {
    const cacheKey = `cache:trip:${agencyKey}:${tripId}:${serviceDate ?? 'current'}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as TripDetailResponse;

    const [agency] = await this.dataSource.query<Array<{ agencyId: string; timezone: string }>>(
      `SELECT "agencyId", timezone FROM agencies WHERE agency_key = $1 LIMIT 1`,
      [agencyKey],
    );
    if (!agency) throw new NotFoundException(`Trip ${tripId} not found`);

    const date = serviceDate ?? (await this.currentServiceDate(tripId, agency));

    const rows = await this.dataSource.query<
      Array<{
        trip_id: string;
        route_id: string;
        trip_headsign: string | null;
        stop_sequence: number;
        stop_id_gtfs: string;
        stop_name: string;
        stop_code: string | null;
        lat: number;
        lon: number;
        arrival_epoch: number | null;
        departure_epoch: number | null;
      }>
    >(
      `SELECT t.trip_id, t.route_id, t.trip_headsign,
              st.stop_sequence,
              s.stop_id AS stop_id_gtfs,
              s.stop_name,
              s.stop_code,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              EXTRACT(EPOCH FROM ${gtfsTimestampSql('$3', 'st.arrival_time', '$4')})::float8 AS arrival_epoch,
              EXTRACT(EPOCH FROM ${gtfsTimestampSql('$3', 'st.departure_time', '$4')})::float8 AS departure_epoch
       FROM trips t
       JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
       JOIN stops s ON s.stop_id = st.stop_id AND s.agency_id = t.agency_id
       WHERE t.trip_id = $1 AND t.agency_id = $2
       ORDER BY st.stop_sequence ASC`,
      [tripId, agency.agencyId, date, agency.timezone],
    );

    if (rows.length === 0) throw new NotFoundException(`Trip ${tripId} not found`);

    const result: TripDetailResponse = {
      tripId: rows[0].trip_id,
      serviceDate: date.replace(/-/g, ''),
      routeId: rows[0].route_id,
      headsign: rows[0].trip_headsign,
      stops: rows.map((row) => ({
        sequence: row.stop_sequence,
        stopId: row.stop_id_gtfs,
        stopName: row.stop_name,
        stopCode: row.stop_code,
        lat: row.lat,
        lon: row.lon,
        scheduledArrival: isoFromEpoch(row.arrival_epoch),
        realtimeArrival: isoFromEpoch(row.arrival_epoch),
        scheduledDeparture: isoFromEpoch(row.departure_epoch),
      })),
    };

    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_TRIP_TTL_S);
    return result;
  }

  private async currentServiceDate(
    tripId: string,
    agency: { agencyId: string; timezone: string },
  ): Promise<string> {
    const { today, yesterday } = candidateServiceDates(agency.timezone);
    const runs = await this.dataSource.query<Array<{ d: string; last_stop_epoch: number | null }>>(
      `WITH ${activeServicesCte('$2', ['$3', '$4'])}
       SELECT to_char(ts.d, 'YYYY-MM-DD') AS d,
              EXTRACT(EPOCH FROM ${gtfsTimestampSql(
                'ts.d',
                'MAX(COALESCE(st.departure_time, st.arrival_time))',
                '$5',
              )})::float8 AS last_stop_epoch
       FROM trips t
       JOIN today_services ts ON ts.service_id = t.service_id AND ts.agency_id = t.agency_id
       JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
       WHERE t.trip_id = $1 AND t.agency_id = $2
       GROUP BY ts.d`,
      [tripId, agency.agencyId, today, yesterday, agency.timezone],
    );
    return pickServiceDate(
      runs.map((r) => ({ d: r.d, lastStopEpoch: r.last_stop_epoch })),
      today,
      yesterday,
      Date.now() / 1000,
    );
  }
}

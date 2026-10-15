import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { StopHierarchy } from './realtime/parse-alerts';
import type { StaticTrip } from './realtime/parse-trip-updates';

type AgencyLookup = {
  trips: ReadonlyMap<string, StaticTrip>;
  stops: StopHierarchy;
};

/**
 * In-memory copy of the static GTFS data the realtime parsers need: the set
 * of known trip_ids and the stop parent/child hierarchy.
 *
 * Loaded once after each static ingestion (and lazily on the first poll after
 * a restart), not on every realtime poll.
 */
@Injectable()
export class StaticLookupService {
  private readonly logger = new Logger(StaticLookupService.name);
  private readonly lookups = new Map<string, AgencyLookup>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Returns the cached lookup, loading it on first use. Returns null while
   * static GTFS hasn't been ingested yet or the database is unreachable;
   * the next call retries.
   */
  async get(agencyKey: string): Promise<AgencyLookup | null> {
    const cached = this.lookups.get(agencyKey);
    if (cached) return cached;
    try {
      return await this.refresh(agencyKey);
    } catch (err: unknown) {
      this.logger.warn(`Could not load static lookup for ${agencyKey}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Reloads from the database. Call after a static ingestion commits. On
   * failure the cached copy is dropped, so the next get() retries instead of
   * using the previous feed's trip_ids (which would mark new trips as ADDED).
   */
  async refresh(agencyKey: string): Promise<AgencyLookup | null> {
    try {
      return await this.load(agencyKey);
    } catch (err: unknown) {
      this.lookups.delete(agencyKey);
      throw err;
    }
  }

  private async load(agencyKey: string): Promise<AgencyLookup | null> {
    const [tripRows, stopRows] = await Promise.all([
      this.dataSource.query<Array<{ tripId: string; routeId: string; directionId: number | null }>>(
        `SELECT t.trip_id AS "tripId", t.route_id AS "routeId", t.direction_id AS "directionId"
           FROM trips t
           JOIN agencies a ON a."agencyId" = t.agency_id
          WHERE a.agency_key = $1`,
        [agencyKey],
      ),
      this.dataSource.query<Array<{ stopId: string; parentId: string }>>(
        `SELECT s.stop_id AS "stopId", s.parent_station_id AS "parentId"
           FROM stops s
           JOIN agencies a ON a."agencyId" = s.agency_id
          WHERE a.agency_key = $1 AND s.parent_station_id IS NOT NULL`,
        [agencyKey],
      ),
    ]);

    if (tripRows.length === 0) {
      this.lookups.delete(agencyKey);
      return null;
    }

    const parentOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();
    for (const { stopId, parentId } of stopRows) {
      parentOf.set(stopId, parentId);
      const children = childrenOf.get(parentId);
      if (children) children.push(stopId);
      else childrenOf.set(parentId, [stopId]);
    }

    const lookup: AgencyLookup = {
      trips: new Map(
        tripRows.map((r) => [r.tripId, { routeId: r.routeId, directionId: r.directionId ?? null }]),
      ),
      stops: { parentOf, childrenOf },
    };
    this.lookups.set(agencyKey, lookup);
    this.logger.log(
      `Loaded static lookup for ${agencyKey}: ${lookup.trips.size} trips, ${parentOf.size} child stops`,
    );
    return lookup;
  }
}

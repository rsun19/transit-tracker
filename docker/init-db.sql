-- Initialize PostGIS extensions for geospatial support
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Trigram extension for fast ILIKE stop searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes on stops(stop_name) and stops(stop_code) are created by the
-- ingestion worker after the stops table is populated (gtfs-static.service.ts).
-- They are not created here because the stops table does not exist at init time.

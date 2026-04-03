-- Initialize PostGIS extensions for geospatial support
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Trigram extension for fast ILIKE stop searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes allow Postgres to use bitmap index scans for
-- stop_name ILIKE '%...%' and stop_code ILIKE '%...%' instead of seq scans.
-- Created with IF NOT EXISTS so re-running init-db is idempotent.
CREATE INDEX IF NOT EXISTS idx_stops_stop_name_trgm ON stops USING gin (stop_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_stops_stop_code_trgm ON stops USING gin (stop_code gin_trgm_ops);

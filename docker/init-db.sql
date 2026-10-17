-- Initialize PostGIS extensions for geospatial support
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Trigram extension for fast ILIKE stop searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Tables and indexes (including the trigram ones) are created by the schema
-- migrations in packages/shared/src/migrations, run by the `migrate` service.

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The schema as it existed in production when migrations were introduced
 * (pg_dump of prod, 2026-10-17, plus agencies.data_version from the atomic
 * static load). Until then the ingestion worker built it with TypeORM
 * `synchronize` and ad-hoc DDL, which is why constraint names are TypeORM's
 * hashes.
 *
 * On a database that already has this schema (agencies exists) it does
 * nothing and is simply recorded as run. A fresh database gets the whole
 * schema. Anything new belongs in a later migration, which runs everywhere.
 */
export class Baseline1792195200000 implements MigrationInterface {
  name = 'Baseline1792195200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const ext of ['postgis', 'pg_trgm', '"uuid-ossp"']) {
      await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
    if (await queryRunner.hasTable('agencies')) return;
    for (const sql of BASELINE_SCHEMA) await queryRunner.query(sql);
  }

  async down(): Promise<void> {
    throw new Error('The baseline migration cannot be reverted; restore a backup instead.');
  }
}

const BASELINE_SCHEMA = [
  `CREATE TABLE public.agencies ( "agencyId" uuid DEFAULT public.uuid_generate_v4() NOT NULL, agency_key character varying(50) NOT NULL, display_name text NOT NULL, timezone character varying(64) NOT NULL, gtfs_static_url text NOT NULL, gtfs_realtime_url text, api_key_env_var character varying(128), last_ingested_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL, data_version integer DEFAULT 0 NOT NULL )`,
  `CREATE TABLE public.route_branches ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, route_id character varying(100) NOT NULL, direction_id smallint, trip_headsign text, trip_id character varying(100) NOT NULL, shape_id character varying(100), stop_count integer NOT NULL )`,
  `CREATE TABLE public.route_stops ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, stop_id character varying(100) NOT NULL, route_id character varying(100) NOT NULL, short_name character varying(50), long_name text, route_type smallint NOT NULL )`,
  `CREATE TABLE public.routes ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, route_id character varying(100) NOT NULL, short_name character varying(50), long_name text, route_type smallint NOT NULL, color character varying(6), text_color character varying(6), created_at timestamp with time zone DEFAULT now() NOT NULL, has_stop_times boolean DEFAULT false NOT NULL )`,
  `CREATE TABLE public.service_calendar_dates ( id uuid DEFAULT public.uuid_generate_v4() NOT NULL, agency_id uuid NOT NULL, service_id character varying(100) NOT NULL, date date NOT NULL, exception_type smallint NOT NULL )`,
  `CREATE TABLE public.service_calendars ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, service_id character varying(100) NOT NULL, monday boolean DEFAULT false NOT NULL, tuesday boolean DEFAULT false NOT NULL, wednesday boolean DEFAULT false NOT NULL, thursday boolean DEFAULT false NOT NULL, friday boolean DEFAULT false NOT NULL, saturday boolean DEFAULT false NOT NULL, sunday boolean DEFAULT false NOT NULL, start_date date NOT NULL, end_date date NOT NULL )`,
  `CREATE TABLE public.shapes ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, shape_id character varying(100) NOT NULL, pt_sequence integer NOT NULL, location public.geometry(Point,4326) NOT NULL )`,
  `CREATE TABLE public.stop_times ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, trip_id character varying(100) NOT NULL, stop_id character varying(100) NOT NULL, stop_sequence integer NOT NULL, arrival_time interval, departure_time interval, stop_headsign text, pickup_type smallint, drop_off_type smallint )`,
  `CREATE TABLE public.stops ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, stop_id character varying(100) NOT NULL, stop_name text NOT NULL, stop_code character varying(50), location public.geometry(Point,4326) NOT NULL, parent_station_id character varying(100), wheelchair_boarding smallint, created_at timestamp with time zone DEFAULT now() NOT NULL, colocated_group_id character varying(100) )`,
  `CREATE TABLE public.trips ( id uuid DEFAULT gen_random_uuid() NOT NULL, agency_id uuid NOT NULL, trip_id character varying(100) NOT NULL, route_id character varying(100) NOT NULL, service_id character varying(100) NOT NULL, trip_headsign text, direction_id smallint, shape_id character varying(100), wheelchair_accessible smallint, created_at timestamp with time zone DEFAULT now() NOT NULL )`,
  `ALTER TABLE ONLY public.shapes ADD CONSTRAINT "PK_18b3503b05dfee84459915dda08" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.stop_times ADD CONSTRAINT "PK_1a2a89e5d5dc41988e05c0ac271" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.service_calendar_dates ADD CONSTRAINT "PK_673bf5c8c00a19f1c2cedbb3705" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.routes ADD CONSTRAINT "PK_76100511cdfa1d013c859f01d8b" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.service_calendars ADD CONSTRAINT "PK_9a4d502e351e4265f2b29e28d62" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.agencies ADD CONSTRAINT "PK_d5d5013a30db81370ceec75beaa" PRIMARY KEY ("agencyId")`,
  `ALTER TABLE ONLY public.stops ADD CONSTRAINT "PK_ed1be877403ad3c921b07f62ca5" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.trips ADD CONSTRAINT "PK_f71c231dee9c05a9522f9e840f5" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.routes ADD CONSTRAINT "UQ_0f5136d8c5cfb2a009e85695f50" UNIQUE (agency_id, route_id)`,
  `ALTER TABLE ONLY public.agencies ADD CONSTRAINT "UQ_53cc71cf06b5105672dc15525b0" UNIQUE (agency_key)`,
  `ALTER TABLE ONLY public.stops ADD CONSTRAINT "UQ_8ac4fff9f5a645007d8cc281f67" UNIQUE (agency_id, stop_id)`,
  `ALTER TABLE ONLY public.trips ADD CONSTRAINT "UQ_97703c47abb6abdf7890bec0e39" UNIQUE (agency_id, trip_id)`,
  `ALTER TABLE ONLY public.service_calendar_dates ADD CONSTRAINT "UQ_f5354462a0a0838cdfb1e5b9519" UNIQUE (agency_id, service_id, date)`,
  `ALTER TABLE ONLY public.service_calendars ADD CONSTRAINT "UQ_ffd065f87205b6d0c1a604e991a" UNIQUE (agency_id, service_id)`,
  `ALTER TABLE ONLY public.route_branches ADD CONSTRAINT route_branches_pkey PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public.route_stops ADD CONSTRAINT route_stops_agency_id_stop_id_route_id_key UNIQUE (agency_id, stop_id, route_id)`,
  `ALTER TABLE ONLY public.route_stops ADD CONSTRAINT route_stops_pkey PRIMARY KEY (id)`,
  `CREATE INDEX "IDX_6b68907ba5838e74a7080c3341" ON public.shapes USING btree (agency_id, shape_id, pt_sequence)`,
  `CREATE INDEX "IDX_736eb092c032d5dae964aa4db3" ON public.trips USING btree (agency_id, service_id)`,
  `CREATE INDEX "IDX_8ca4977da2e7e43fe303e15969" ON public.trips USING btree (agency_id, route_id)`,
  `CREATE INDEX "IDX_8da8e722bebe8fbcf8fe9f4f54" ON public.routes USING btree (agency_id, route_type)`,
  `CREATE INDEX "IDX_920e71d4ead7cfc9bd4d4ec70b" ON public.stops USING gist (location)`,
  `CREATE INDEX "IDX_9be55309b3d9d0f4e543612cde" ON public.stops USING btree (colocated_group_id)`,
  `CREATE INDEX "IDX_ea6f3c5b16a6649a36584ca6c0" ON public.stops USING btree (agency_id, stop_code)`,
  `CREATE INDEX idx_route_branches_agency_route ON public.route_branches USING btree (agency_id, route_id)`,
  `CREATE INDEX idx_route_stops_agency_stop ON public.route_stops USING btree (agency_id, stop_id)`,
  `CREATE INDEX idx_service_calendar_dates_agency_date ON public.service_calendar_dates USING btree (agency_id, date)`,
  `CREATE INDEX idx_stop_times_agency_stop_dept ON public.stop_times USING btree (agency_id, stop_id, departure_time)`,
  `CREATE INDEX idx_stop_times_agency_trip_seq ON public.stop_times USING btree (agency_id, trip_id, stop_sequence)`,
  `CREATE INDEX idx_stops_stop_code_trgm ON public.stops USING gin (stop_code public.gin_trgm_ops)`,
  `CREATE INDEX idx_stops_stop_name_trgm ON public.stops USING gin (stop_name public.gin_trgm_ops)`,
  `ALTER TABLE ONLY public.stop_times ADD CONSTRAINT "FK_0c07b138548ae8c9631a22e4c9d" FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.trips ADD CONSTRAINT "FK_634fb592707103851167924a185" FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.service_calendars ADD CONSTRAINT "FK_6af71deb641eff17871cd290c8c" FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.routes ADD CONSTRAINT "FK_7642ed6f5276084f2e463793c29" FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.stops ADD CONSTRAINT "FK_85e810c8bf729b5e8c1506b1a42" FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.shapes ADD CONSTRAINT "FK_c98089aaff4eb25cd0c2a98fdea" FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.service_calendar_dates ADD CONSTRAINT "FK_e109dc91598fc2ee3192e250ce7" FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.route_branches ADD CONSTRAINT route_branches_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
  `ALTER TABLE ONLY public.route_stops ADD CONSTRAINT route_stops_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agencies("agencyId") ON DELETE CASCADE`,
];

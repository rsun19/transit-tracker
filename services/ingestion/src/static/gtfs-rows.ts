// Converts GTFS CSV rows into COPY lines for the staging tables.
//
// Every field goes through copyField(), so a value containing a comma, quote
// or newline can't split into extra columns or rows (or name another agency).
// Rows a table can't hold (missing ids, unparseable times or numbers) are
// dropped and counted rather than failing the whole load.

/** A COPY value: null is SQL NULL, '' is an empty string. */
export type CopyValue = string | null;

export type Row = Record<string, string | undefined>;

/** Formats one value for COPY ... WITH (FORMAT csv, NULL ''). */
export function copyField(v: CopyValue): string {
  if (v === null) return '';
  // Quote empty strings too, or COPY would read them as NULL.
  if (v === '' || /[",\r\n]/.test(v) || v.trim() !== v) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function copyLine(values: CopyValue[]): string {
  return values.map(copyField).join(',') + '\n';
}

// Hours may exceed 24 (trips past midnight); minutes and seconds may not.
const GTFS_TIME = /^\d{1,3}:[0-5]\d:[0-5]\d$/;
const GTFS_DATE = /^\d{8}$/;
const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;

const text = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** A non-negative integer, else undefined (invalid). Empty is null. */
const optionalInt = (v: string | undefined): string | null | undefined => {
  const t = v?.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? String(n) : undefined;
};

const optionalTime = (v: string | undefined): string | null | undefined => {
  const t = v?.trim();
  if (!t) return null;
  return GTFS_TIME.test(t) ? t : undefined;
};

const point = (latRaw: string | undefined, lonRaw: string | undefined): string | null => {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!latRaw?.trim() || !lonRaw?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return `SRID=4326;POINT(${lon} ${lat})`;
};

/** A staging table's columns and how to build its row; null drops the row. */
export type TableSpec = {
  table: string;
  file: string;
  columns: string[];
  toRow: (row: Row, agencyId: string) => CopyValue[] | null;
};

export const ROUTES: TableSpec = {
  table: 'routes',
  file: 'routes.txt',
  columns: [
    'agency_id',
    'route_id',
    'short_name',
    'long_name',
    'route_type',
    'color',
    'text_color',
  ],
  toRow: (r, agencyId) => {
    const routeId = text(r['route_id']);
    const routeType = optionalInt(r['route_type']);
    if (!routeId || !routeType) return null;
    const color = (v: string | undefined) => (v && HEX_COLOR.test(v.trim()) ? v.trim() : null);
    return [
      agencyId,
      routeId,
      text(r['route_short_name']),
      text(r['route_long_name']),
      routeType,
      color(r['route_color']),
      color(r['route_text_color']),
    ];
  },
};

export const TRIPS: TableSpec = {
  table: 'trips',
  file: 'trips.txt',
  columns: [
    'agency_id',
    'trip_id',
    'route_id',
    'service_id',
    'trip_headsign',
    'direction_id',
    'shape_id',
    'wheelchair_accessible',
  ],
  toRow: (r, agencyId) => {
    const tripId = text(r['trip_id']);
    const routeId = text(r['route_id']);
    const serviceId = text(r['service_id']);
    const direction = optionalInt(r['direction_id']);
    const wheelchair = optionalInt(r['wheelchair_accessible']);
    if (!tripId || !routeId || !serviceId) return null;
    if (direction === undefined || wheelchair === undefined) return null;
    return [
      agencyId,
      tripId,
      routeId,
      serviceId,
      text(r['trip_headsign']),
      direction,
      text(r['shape_id']),
      wheelchair,
    ];
  },
};

export const STOPS: TableSpec = {
  table: 'stops',
  file: 'stops.txt',
  columns: [
    'agency_id',
    'stop_id',
    'stop_name',
    'stop_code',
    'location',
    'parent_station_id',
    'wheelchair_boarding',
  ],
  toRow: (r, agencyId) => {
    const stopId = text(r['stop_id']);
    const location = point(r['stop_lat'], r['stop_lon']);
    const wheelchair = optionalInt(r['wheelchair_boarding']);
    // Stops without coordinates (e.g. generic nodes) can't be placed on the map.
    if (!stopId || !location || wheelchair === undefined) return null;
    return [
      agencyId,
      stopId,
      text(r['stop_name']) ?? '',
      text(r['stop_code']),
      location,
      text(r['parent_station']),
      wheelchair,
    ];
  },
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export const CALENDARS: TableSpec = {
  table: 'service_calendars',
  file: 'calendar.txt',
  columns: ['agency_id', 'service_id', ...DAYS, 'start_date', 'end_date'],
  toRow: (r, agencyId) => {
    const serviceId = text(r['service_id']);
    const start = r['start_date']?.trim() ?? '';
    const end = r['end_date']?.trim() ?? '';
    if (!serviceId || !GTFS_DATE.test(start) || !GTFS_DATE.test(end)) return null;
    return [
      agencyId,
      serviceId,
      ...DAYS.map((d) => (r[d]?.trim() === '1' ? 't' : 'f')),
      start,
      end,
    ];
  },
};

export const CALENDAR_DATES: TableSpec = {
  table: 'service_calendar_dates',
  file: 'calendar_dates.txt',
  columns: ['agency_id', 'service_id', 'date', 'exception_type'],
  toRow: (r, agencyId) => {
    const serviceId = text(r['service_id']);
    const date = r['date']?.trim() ?? '';
    const type = r['exception_type']?.trim();
    // Only 1 (added) and 2 (removed) are defined.
    if (!serviceId || !GTFS_DATE.test(date) || (type !== '1' && type !== '2')) return null;
    return [agencyId, serviceId, date, type];
  },
};

export const STOP_TIMES: TableSpec = {
  table: 'stop_times',
  file: 'stop_times.txt',
  columns: [
    'agency_id',
    'trip_id',
    'stop_id',
    'stop_sequence',
    'arrival_time',
    'departure_time',
    'stop_headsign',
    'pickup_type',
    'drop_off_type',
  ],
  toRow: (r, agencyId) => {
    const tripId = text(r['trip_id']);
    const stopId = text(r['stop_id']);
    const sequence = optionalInt(r['stop_sequence']);
    const arrival = optionalTime(r['arrival_time']);
    const departure = optionalTime(r['departure_time']);
    const pickup = optionalInt(r['pickup_type']);
    const dropOff = optionalInt(r['drop_off_type']);
    if (!tripId || !stopId || !sequence) return null;
    if ([arrival, departure, pickup, dropOff].includes(undefined)) return null;
    return [
      agencyId,
      tripId,
      stopId,
      sequence,
      arrival ?? null,
      departure ?? null,
      text(r['stop_headsign']),
      pickup ?? null,
      dropOff ?? null,
    ];
  },
};

export const SHAPES: TableSpec = {
  table: 'shapes',
  file: 'shapes.txt',
  columns: ['agency_id', 'shape_id', 'pt_sequence', 'location'],
  toRow: (r, agencyId) => {
    const shapeId = text(r['shape_id']);
    const sequence = optionalInt(r['shape_pt_sequence']);
    const location = point(r['shape_pt_lat'], r['shape_pt_lon']);
    if (!shapeId || !sequence || !location) return null;
    return [agencyId, shapeId, sequence, location];
  },
};

/** Loaded in this order; all go through staging and swap together. */
export const STAGED_TABLES: TableSpec[] = [
  ROUTES,
  TRIPS,
  STOPS,
  CALENDARS,
  CALENDAR_DATES,
  STOP_TIMES,
  SHAPES,
];

/** A feed missing any of these is treated as broken and not loaded. */
export const REQUIRED_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
];
/** At least one of these must be present. */
export const CALENDAR_FILES = ['calendar.txt', 'calendar_dates.txt'];

/** Core tables whose row count may not drop below this share of the previous load. */
export const CORE_TABLES = ['routes', 'stops', 'trips', 'stop_times'];
export const MIN_ROW_RATIO = 0.5;

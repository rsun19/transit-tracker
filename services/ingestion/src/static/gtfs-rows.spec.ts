/// <reference types="jest" />
import {
  CALENDARS,
  ROUTES,
  SHAPES,
  STOPS,
  STOP_TIMES,
  TRIPS,
  copyField,
  copyLine,
} from './gtfs-rows';

const A = 'agency-uuid';

describe('copyField()', () => {
  it('leaves plain values alone and writes NULL as an empty field', () => {
    expect(copyField('Red')).toBe('Red');
    expect(copyField(null)).toBe('');
  });

  it('quotes an empty string so COPY keeps it distinct from NULL', () => {
    expect(copyField('')).toBe('""');
  });

  it('quotes and escapes commas, quotes and newlines', () => {
    expect(copyField('a,b')).toBe('"a,b"');
    expect(copyField('say "hi"')).toBe('"say ""hi"""');
    expect(copyField('line\nbreak')).toBe('"line\nbreak"');
  });

  it("can't be used to add a row for another agency", () => {
    const hostile = 'x"\nother-agency,T9,S9,1';
    expect(copyLine([A, hostile])).toBe(`${A},"x""\nother-agency,T9,S9,1"\n`);
  });
});

describe('STOP_TIMES', () => {
  const row = (o: Record<string, string>) =>
    STOP_TIMES.toRow(
      {
        trip_id: 'T1',
        stop_id: 'S1',
        stop_sequence: '3',
        arrival_time: '08:00:00',
        departure_time: '08:01:00',
        ...o,
      },
      A,
    );

  it.each(['8:05:00', '24:10:00', '123:00:59'])('accepts GTFS time %s', (t) => {
    expect(row({ arrival_time: t })).not.toBeNull();
  });

  it.each(['25:99:99', '08:60:00', '08:00', '8.05.00', '08:00:00;DROP'])(
    'drops the row for time %s',
    (t) => {
      expect(row({ arrival_time: t })).toBeNull();
    },
  );

  it.each(['', '-1', '1.5', 'x', '1,2'])('drops the row for stop_sequence %p', (seq) => {
    expect(row({ stop_sequence: seq })).toBeNull();
  });

  it('keeps empty times as NULL (untimed stops)', () => {
    expect(row({ arrival_time: '', departure_time: '' })).toEqual([
      A,
      'T1',
      'S1',
      '3',
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('row conversion', () => {
  it('routes: keeps route_type 0, rejects colors that are not hex', () => {
    expect(
      ROUTES.toRow(
        { route_id: 'Red', route_type: '0', route_color: 'DA291C', route_text_color: 'bad' },
        A,
      ),
    ).toEqual([A, 'Red', null, null, '0', 'DA291C', null]);
    expect(ROUTES.toRow({ route_id: 'X', route_type: '' }, A)).toBeNull();
  });

  it('trips: requires service_id and integer direction', () => {
    const base = { trip_id: 'T', route_id: 'R', service_id: 'S' };
    expect(TRIPS.toRow(base, A)).not.toBeNull();
    expect(TRIPS.toRow({ ...base, service_id: '' }, A)).toBeNull();
    expect(TRIPS.toRow({ ...base, direction_id: 'north' }, A)).toBeNull();
  });

  it('stops: builds an EWKT point and drops stops without coordinates', () => {
    expect(
      STOPS.toRow({ stop_id: 'S', stop_name: 'Main', stop_lat: '42.35', stop_lon: '-71.06' }, A),
    ).toEqual([A, 'S', 'Main', null, 'SRID=4326;POINT(-71.06 42.35)', null, null]);
    expect(STOPS.toRow({ stop_id: 'S', stop_lat: '', stop_lon: '' }, A)).toBeNull();
    expect(STOPS.toRow({ stop_id: 'S', stop_lat: '91', stop_lon: '0' }, A)).toBeNull();
  });

  it('stops: a missing name is an empty string, not NULL (the column is NOT NULL)', () => {
    expect(STOPS.toRow({ stop_id: 'S', stop_lat: '1', stop_lon: '1' }, A)?.[2]).toBe('');
  });

  it('calendars: weekday flags and YYYYMMDD dates', () => {
    expect(
      CALENDARS.toRow(
        {
          service_id: 'W',
          monday: '1',
          tuesday: '0',
          start_date: '20260101',
          end_date: '20261231',
        },
        A,
      ),
    ).toEqual([A, 'W', 't', 'f', 'f', 'f', 'f', 'f', 'f', '20260101', '20261231']);
    expect(
      CALENDARS.toRow({ service_id: 'W', start_date: '2026-01-01', end_date: '20261231' }, A),
    ).toBeNull();
  });

  it('shapes: drops points without valid coordinates', () => {
    expect(
      SHAPES.toRow(
        { shape_id: 'SH', shape_pt_sequence: '1', shape_pt_lat: 'x', shape_pt_lon: '1' },
        A,
      ),
    ).toBeNull();
  });
});

// A tiny GTFS feed: two routes, three stops (two of them the same place on
// opposite sides of the street), four trips.
import type { ZipEntry } from './zip';

export const FEED: Record<string, string> = {
  'agency.txt':
    'agency_id,agency_name,agency_url,agency_timezone\n1,Test,https://example.com,America/New_York\n',
  'routes.txt':
    'route_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n' +
    'R1,1,Route One,3,FF0000,FFFFFF\n' +
    'R2,2,Route Two,3,not-a-color,\n',
  'stops.txt':
    'stop_id,stop_name,stop_code,stop_lat,stop_lon,parent_station,wheelchair_boarding,location_type\n' +
    'S1,Main St,101,42.3500,-71.0600,,1,0\n' +
    'S2,Main St,102,42.3501,-71.0601,,1,0\n' +
    'S3,Elm St,103,42.3600,-71.0700,,0,0\n' +
    'NODE,Node without coordinates,,,,,,3\n',
  'trips.txt':
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id,wheelchair_accessible\n' +
    'R1,WKDY,T1,Elm St,0,SH1,1\n' +
    'R1,WKDY,T2,Main St,1,SH1,1\n' +
    'R2,WKDY,T3,Elm St,0,,\n' +
    'R2,WKDY,T4,Elm St,0,,\n',
  'calendar.txt':
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
    'WKDY,1,1,1,1,1,0,0,20260101,20261231\n',
  'calendar_dates.txt': 'service_id,date,exception_type\nWKDY,20261111,2\n',
  'stop_times.txt':
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
    'T1,08:00:00,08:00:00,S1,1,,0,0\n' +
    'T1,08:10:00,08:10:00,S3,2,,0,1\n' +
    'T2,09:00:00,09:00:00,S3,1,,0,0\n' +
    'T2,25:10:00,25:10:00,S2,2,,0,1\n' +
    'T3,10:00:00,10:00:00,S2,1,"Via ""Elm"", then\nnorth",0,0\n' +
    'T3,10:05:00,10:05:00,S3,2,,0,0\n' +
    'T4,11:00:00,11:00:00,S2,1,,0,0\n' +
    'T4,11:99:00,11:99:00,S3,2,,0,0\n',
  'shapes.txt':
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
    'SH1,42.35,-71.06,1\n' +
    'SH1,42.36,-71.07,2\n' +
    'SH1,bad,-71.07,3\n',
};

export const feedEntries = (overrides: Record<string, string | null> = {}): ZipEntry[] =>
  Object.entries({ ...FEED, ...overrides })
    .filter((e): e is [string, string] => e[1] !== null)
    .map(([name, data]) => ({ name, data }));

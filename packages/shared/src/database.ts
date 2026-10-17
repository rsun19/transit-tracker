import { Agency } from './entities/agency.entity';
import { Route } from './entities/route.entity';
import { ServiceCalendarDate } from './entities/service-calendar-date.entity';
import { ServiceCalendar } from './entities/service-calendar.entity';
import { Shape } from './entities/shape.entity';
import { StopTime } from './entities/stop-time.entity';
import { Stop } from './entities/stop.entity';
import { Trip } from './entities/trip.entity';

/** Every TypeORM entity. route_stops and route_branches are raw-SQL tables. */
export const ENTITIES = [
  Agency,
  Route,
  Stop,
  StopTime,
  Trip,
  Shape,
  ServiceCalendar,
  ServiceCalendarDate,
];

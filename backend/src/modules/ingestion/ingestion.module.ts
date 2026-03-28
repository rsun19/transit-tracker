import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route } from '../routes/entities/route.entity.js';
import { Stop } from '../stops/entities/stop.entity.js';
import { StopTime } from '../stops/entities/stop-time.entity.js';
import { Trip } from '../trips/entities/trip.entity.js';
import { Shape } from './entities/shape.entity.js';
import { ServiceCalendar } from './entities/service-calendar.entity.js';
import { Agency } from '../agencies/entities/agency.entity.js';
import { GtfsStaticService } from './gtfs-static.service.js';
import { GtfsRealtimeService } from './gtfs-realtime.service.js';
import { IngestionScheduler } from './ingestion.scheduler.js';
import { AgenciesModule } from '../agencies/agencies.module.js';
import { CacheModule } from '../cache/cache.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Agency, Route, Stop, StopTime, Trip, Shape, ServiceCalendar]),
    AgenciesModule,
    CacheModule,
  ],
  providers: [GtfsStaticService, GtfsRealtimeService, IngestionScheduler],
  exports: [GtfsStaticService, GtfsRealtimeService],
})
export class IngestionModule {}

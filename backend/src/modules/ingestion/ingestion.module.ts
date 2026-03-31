import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route } from '../routes/entities/route.entity';
import { Stop } from '../stops/entities/stop.entity';
import { StopTime } from '../stops/entities/stop-time.entity';
import { Trip } from '../trips/entities/trip.entity';
import { Shape } from './entities/shape.entity';
import { ServiceCalendar } from './entities/service-calendar.entity';
import { Agency } from '../agencies/entities/agency.entity';
import { GtfsStaticService } from './gtfs-static.service';
import { GtfsRealtimeService } from './gtfs-realtime.service';
import { IngestionScheduler } from './ingestion.scheduler';
import { AgenciesModule } from '../agencies/agencies.module';
import { CacheModule } from '../cache/cache.module';

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

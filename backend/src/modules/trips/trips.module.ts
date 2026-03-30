import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trip } from './entities/trip.entity.js';
import { StopTime } from '../stops/entities/stop-time.entity.js';
import { Stop } from '../stops/entities/stop.entity.js';
import { TripsService } from './trips.service.js';
import { TripsController } from './trips.controller.js';
import { CacheModule } from '../cache/cache.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Trip, StopTime, Stop]), CacheModule],
  providers: [TripsService],
  controllers: [TripsController],
  exports: [TripsService],
})
export class TripsModule {}

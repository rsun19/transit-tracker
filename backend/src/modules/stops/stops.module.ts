import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stop } from './entities/stop.entity.js';
import { StopTime } from './entities/stop-time.entity.js';
import { Trip } from '../trips/entities/trip.entity.js';
import { Route } from '../routes/entities/route.entity.js';
import { StopsService } from './stops.service.js';
import { StopsController } from './stops.controller.js';
import { CacheModule } from '../cache/cache.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Stop, StopTime, Trip, Route]), CacheModule],
  providers: [StopsService],
  controllers: [StopsController],
  exports: [StopsService],
})
export class StopsModule {}

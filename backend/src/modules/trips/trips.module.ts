import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trip } from './entities/trip.entity';
import { StopTime } from '../stops/entities/stop-time.entity';
import { Stop } from '../stops/entities/stop.entity';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [TypeOrmModule.forFeature([Trip, StopTime, Stop]), CacheModule],
  providers: [TripsService],
  controllers: [TripsController],
  exports: [TripsService],
})
export class TripsModule {}

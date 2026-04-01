import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stop } from './entities/stop.entity';
import { StopTime } from './entities/stop-time.entity';
import { Trip } from '@/modules/trips/entities/trip.entity';
import { Route } from '@/modules/routes/entities/route.entity';
import { StopsService } from './stops.service';
import { StopsController } from './stops.controller';
import { CacheModule } from '@/modules/cache/cache.module';

@Module({
  imports: [TypeOrmModule.forFeature([Stop, StopTime, Trip, Route]), CacheModule],
  providers: [StopsService],
  controllers: [StopsController],
  exports: [StopsService],
})
export class StopsModule {}

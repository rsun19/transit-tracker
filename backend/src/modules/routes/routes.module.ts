import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route } from './entities/route.entity.js';
import { Shape } from '../ingestion/entities/shape.entity.js';
import { RoutesService } from './routes.service.js';
import { RoutesController } from './routes.controller.js';
import { CacheModule } from '../cache/cache.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Route, Shape]), CacheModule],
  providers: [RoutesService],
  controllers: [RoutesController],
  exports: [RoutesService],
})
export class RoutesModule {}

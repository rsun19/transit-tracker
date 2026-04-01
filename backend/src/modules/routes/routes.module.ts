import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route } from './entities/route.entity';
import { Shape } from '@/modules/ingestion/entities/shape.entity';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { CacheModule } from '@/modules/cache/cache.module';

@Module({
  imports: [TypeOrmModule.forFeature([Route, Shape]), CacheModule],
  providers: [RoutesService],
  controllers: [RoutesController],
  exports: [RoutesService],
})
export class RoutesModule {}

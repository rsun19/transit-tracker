import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration.js';
import { Agency } from './modules/agencies/entities/agency.entity.js';
import { Route } from './modules/routes/entities/route.entity.js';
import { Stop } from './modules/stops/entities/stop.entity.js';
import { StopTime } from './modules/stops/entities/stop-time.entity.js';
import { Trip } from './modules/trips/entities/trip.entity.js';
import { Shape } from './modules/ingestion/entities/shape.entity.js';
import { ServiceCalendar } from './modules/ingestion/entities/service-calendar.entity.js';
import { CacheModule } from './modules/cache/cache.module.js';
import { AgenciesModule } from './modules/agencies/agencies.module.js';
import { RoutesModule } from './modules/routes/routes.module.js';
import { StopsModule } from './modules/stops/stops.module.js';
import { TripsModule } from './modules/trips/trips.module.js';
import { VehiclesModule } from './modules/vehicles/vehicles.module.js';
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: () => configuration(),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [Agency, Route, Stop, StopTime, Trip, Shape, ServiceCalendar],
        synchronize: true, // auto-create schema; use migrations for production hardening
        logging: configService.get<string>('NODE_ENV') === 'development',
      }),
    }),
    CacheModule,
    AgenciesModule,
    RoutesModule,
    StopsModule,
    TripsModule,
    VehiclesModule,
    AlertsModule,
    HealthModule,
  ],
})
export class AppModule {}

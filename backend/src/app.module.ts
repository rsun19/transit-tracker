import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { Agency } from './modules/agencies/entities/agency.entity';
import { Route } from './modules/routes/entities/route.entity';
import { Stop } from './modules/stops/entities/stop.entity';
import { StopTime } from './modules/stops/entities/stop-time.entity';
import { Trip } from './modules/trips/entities/trip.entity';
import { Shape } from './modules/ingestion/entities/shape.entity';
import { ServiceCalendar } from './modules/ingestion/entities/service-calendar.entity';
import { CacheModule } from './modules/cache/cache.module';
import { AgenciesModule } from './modules/agencies/agencies.module';
import { RoutesModule } from './modules/routes/routes.module';
import { StopsModule } from './modules/stops/stops.module';
import { TripsModule } from './modules/trips/trips.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { HealthModule } from './modules/health/health.module';

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

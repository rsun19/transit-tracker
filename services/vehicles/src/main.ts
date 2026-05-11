import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { VehiclesModule } from './vehicles.module';

async function bootstrap() {
  const app = await NestFactory.create(VehiclesModule, {
    logger: {
      log: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'log',
            service: context ?? 'Vehicles',
            message,
          }) + '\n',
        ),
      error: (message: string, trace?: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: context ?? 'Vehicles',
            message,
            trace,
          }) + '\n',
        ),
      warn: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: context ?? 'Vehicles',
            message,
          }) + '\n',
        ),
      debug: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'debug',
            service: context ?? 'Vehicles',
            message,
          }) + '\n',
        ),
      verbose: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'verbose',
            service: context ?? 'Vehicles',
            message,
          }) + '\n',
        ),
    },
  });

  app.enableCors({ origin: false });

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3005;
  await app.listen(port);
  Logger.log(`Vehicles service listening on port ${port}`, 'Bootstrap');
}

void bootstrap();

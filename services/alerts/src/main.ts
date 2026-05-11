import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AlertsModule } from './alerts.module';

async function bootstrap() {
  const app = await NestFactory.create(AlertsModule, {
    logger: {
      log: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'log',
            service: context ?? 'Alerts',
            message,
          }) + '\n',
        ),
      error: (message: string, trace?: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: context ?? 'Alerts',
            message,
            trace,
          }) + '\n',
        ),
      warn: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: context ?? 'Alerts',
            message,
          }) + '\n',
        ),
      debug: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'debug',
            service: context ?? 'Alerts',
            message,
          }) + '\n',
        ),
      verbose: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'verbose',
            service: context ?? 'Alerts',
            message,
          }) + '\n',
        ),
    },
  });

  app.enableCors({ origin: false });

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3004;
  await app.listen(port);
  Logger.log(`Alerts service listening on port ${port}`, 'Bootstrap');
}

void bootstrap();

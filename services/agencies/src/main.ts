import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AgenciesModule } from './agencies.module';

async function bootstrap() {
  const app = await NestFactory.create(AgenciesModule, {
    logger: {
      log: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'log',
            service: context ?? 'Agencies',
            message,
          }) + '\n',
        ),
      error: (message: string, trace?: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: context ?? 'Agencies',
            message,
            trace,
          }) + '\n',
        ),
      warn: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: context ?? 'Agencies',
            message,
          }) + '\n',
        ),
      debug: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'debug',
            service: context ?? 'Agencies',
            message,
          }) + '\n',
        ),
      verbose: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'verbose',
            service: context ?? 'Agencies',
            message,
          }) + '\n',
        ),
    },
  });

  app.enableCors({ origin: false });

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3001;
  await app.listen(port);
  Logger.log(`Agencies service listening on port ${port}`, 'Bootstrap');
}

void bootstrap();

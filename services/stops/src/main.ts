import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { StopsModule } from './stops.module';
import { HttpExceptionFilter } from './http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(StopsModule, {
    logger: {
      log: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'log',
            service: context ?? 'Stops',
            message,
          }) + '\n',
        ),
      error: (message: string, trace?: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: context ?? 'Stops',
            message,
            trace,
          }) + '\n',
        ),
      warn: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: context ?? 'Stops',
            message,
          }) + '\n',
        ),
      debug: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'debug',
            service: context ?? 'Stops',
            message,
          }) + '\n',
        ),
      verbose: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'verbose',
            service: context ?? 'Stops',
            message,
          }) + '\n',
        ),
    },
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: false });

  const httpServer = app.getHttpServer() as import('http').Server;
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3003;
  await app.listen(port);
  Logger.log(`Stops service listening on port ${port}`, 'Bootstrap');
}

void bootstrap();

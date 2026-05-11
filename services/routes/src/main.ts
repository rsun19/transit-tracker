import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RoutesModule } from './routes.module';
import { HttpExceptionFilter } from './http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(RoutesModule, {
    logger: {
      log: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'log',
            service: context ?? 'Routes',
            message,
          }) + '\n',
        ),
      error: (message: string, trace?: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: context ?? 'Routes',
            message,
            trace,
          }) + '\n',
        ),
      warn: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: context ?? 'Routes',
            message,
          }) + '\n',
        ),
      debug: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'debug',
            service: context ?? 'Routes',
            message,
          }) + '\n',
        ),
      verbose: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'verbose',
            service: context ?? 'Routes',
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

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3002;
  await app.listen(port);
  Logger.log(`Routes service listening on port ${port}`, 'Bootstrap');
}

void bootstrap();

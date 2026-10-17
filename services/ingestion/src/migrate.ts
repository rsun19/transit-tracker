// One-shot: applies pending schema migrations, then exits. Run by the compose
// `migrate` service before the worker and API services start, so they never
// need DDL rights and nothing uses TypeORM `synchronize`.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENTITIES, MIGRATIONS } from '@transit-tracker/shared';
import { createLogger } from '@transit-tracker/shared/nest';

export function migrationDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    // Each migration commits on its own, so a failure keeps the earlier ones.
    migrationsTransactionMode: 'each',
    synchronize: false,
  });
}

async function main(): Promise<void> {
  Logger.overrideLogger(createLogger('Migrate'));
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  const dataSource = migrationDataSource(url);
  await dataSource.initialize();
  try {
    const ran = await dataSource.runMigrations();
    Logger.log(
      ran.length > 0
        ? `Applied ${ran.length} migration(s): ${ran.map((m) => m.name).join(', ')}`
        : 'Schema is up to date',
      'Migrate',
    );
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    Logger.error(`Migration failed: ${(err as Error).message}`, (err as Error).stack, 'Migrate');
    process.exit(1);
  });
}

import { Baseline1792195200000 } from './1792195200000-Baseline';
import { IndexesAndSafetyNets1792195300000 } from './1792195300000-IndexesAndSafetyNets';

/**
 * Every schema migration, oldest first. Run by the one-shot `migrate`
 * service before anything else that uses the database; no service uses
 * TypeORM `synchronize`. A schema change needs a new migration here (the
 * entity-drift test fails otherwise).
 */
export const MIGRATIONS = [Baseline1792195200000, IndexesAndSafetyNets1792195300000];

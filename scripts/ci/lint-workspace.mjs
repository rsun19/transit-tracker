import { spawnSync } from 'node:child_process';

const projects = [
  { name: 'frontend', dir: 'frontend' },
  { name: 'agencies', dir: 'services/agencies' },
  { name: 'alerts', dir: 'services/alerts' },
  { name: 'vehicles', dir: 'services/vehicles' },
  { name: 'routes', dir: 'services/routes' },
  { name: 'stops', dir: 'services/stops' },
  { name: 'ingestion', dir: 'services/ingestion' },
];

const isFix = process.argv.includes('--fix');
const suffix = isFix ? ':fix' : '';
let failures = 0;

for (const p of projects) {
  const args = ['run', `lint${suffix}`, '--prefix', p.dir];
  console.log(`\n[lint:${p.name}] npm ${args.join(' ')}`);
  const result = spawnSync('npm', args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (result.error) {
    console.error(`[lint:${p.name}] ${result.error.message}`);
    failures += 1;
    continue;
  }
  if (result.status !== 0) {
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n[lint] failed in ${failures} project(s)`);
  process.exit(1);
}

console.log('\n[lint] all project diagnostics passed');

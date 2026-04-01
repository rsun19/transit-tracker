import { spawnSync } from 'node:child_process';

const checks = [
  { name: 'backend', args: ['run', 'typecheck', '--prefix', 'backend'] },
  { name: 'frontend', args: ['run', 'typecheck', '--prefix', 'frontend'] },
];

let failures = 0;

for (const check of checks) {
  console.log(`\n[typecheck:${check.name}] npm ${check.args.join(' ')}`);
  const result = spawnSync('npm', check.args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (result.error) {
    console.error(`[typecheck:${check.name}] ${result.error.message}`);
    failures += 1;
    continue;
  }

  if (result.status !== 0) {
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n[typecheck] failed in ${failures} project(s)`);
  process.exit(1);
}

console.log('\n[typecheck] all project diagnostics passed');

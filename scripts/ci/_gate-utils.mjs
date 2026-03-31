import { spawnSync } from 'node:child_process';

export const REQUIRED_CHECKS = [
  'lint',
  'unit',
  'integration',
  'contract',
  'accessibility',
  'performance',
  'cypress-map',
  'cypress-stops',
  'cypress-routes',
  'cypress-core-smoke',
  'peer-review-validation',
];

export function runCommand(command, args, label, extraEnv = {}) {
  console.log(`\n[gate:${label}] Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`[gate:${label}] failed with exit code ${result.status}`);
  }
}

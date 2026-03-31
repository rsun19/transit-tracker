import { spawnSync } from 'node:child_process';

const singleGroup = process.env.CYPRESS_GROUP;
const groups = singleGroup ? [singleGroup] : ['map', 'stops', 'routes', 'core-smoke'];

const minScenarioResult = spawnSync('node', ['scripts/ci/ensure-cypress-min-scenarios.mjs'], {
  stdio: 'inherit',
});
if (minScenarioResult.status !== 0) {
  process.exit(minScenarioResult.status ?? 1);
}

for (const group of groups) {
  const result = spawnSync('node', ['scripts/e2e/run-cypress-group.mjs', `--group=${group}`], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CYPRESS_GROUP: group,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

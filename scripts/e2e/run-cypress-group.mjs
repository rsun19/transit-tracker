import { spawnSync } from 'node:child_process';

const argGroup = process.argv.find((arg) => arg.startsWith('--group='));
const group = (argGroup ? argGroup.split('=')[1] : process.env.CYPRESS_GROUP) ?? 'map';

const groupPattern = {
  map: 'tests/e2e/specs/map/**/*.cy.ts',
  stops: 'tests/e2e/specs/stops/**/*.cy.ts',
  routes: 'tests/e2e/specs/routes/**/*.cy.ts',
  'core-smoke': 'tests/e2e/specs/core-smoke/**/*.cy.ts',
};

if (!(group in groupPattern)) {
  console.error(`Unknown Cypress group: ${group}`);
  process.exit(1);
}

const guard = spawnSync('node', ['scripts/ci/ensure-cypress-tests-found.mjs', group], {
  stdio: 'inherit',
});
if (guard.status !== 0) {
  process.exit(guard.status ?? 1);
}

console.log(`[cypress:${group}] Running pattern: ${groupPattern[group]}`);

const cypressArgs = [
  'cypress',
  'run',
  '--config-file',
  'tests/e2e/cypress.config.mjs',
  '--spec',
  groupPattern[group],
  '--browser',
  'electron',
  '--headless',
];

const result = spawnSync('npx', cypressArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CYPRESS_GROUP: group,
  },
});

process.exit(result.status ?? 1);

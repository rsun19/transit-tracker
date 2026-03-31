import fs from 'node:fs';
import path from 'node:path';

const minScenarios = Number(process.env.CYPRESS_MIN_SCENARIOS ?? '12');
const rootSpecsDir = path.join(process.cwd(), 'tests', 'e2e', 'specs');

const specFiles = [];

function walk(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.cy.ts')) {
      specFiles.push(fullPath);
    }
  }
}

walk(rootSpecsDir);

let scenarioCount = 0;
for (const filePath of specFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const matches = source.match(/\bit\s*\(/g);
  scenarioCount += matches ? matches.length : 0;
}

console.log(
  `Discovered ${scenarioCount} Cypress scenario(s) across ${specFiles.length} spec file(s).`,
);

if (scenarioCount < minScenarios) {
  console.error(`Expected at least ${minScenarios} Cypress scenarios, found ${scenarioCount}.`);
  process.exit(1);
}

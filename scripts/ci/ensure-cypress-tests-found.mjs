import fs from 'node:fs';
import path from 'node:path';

const group = process.argv[2] ?? process.env.CYPRESS_GROUP;

if (!group) {
  console.error(
    'Usage: node scripts/ci/ensure-cypress-tests-found.mjs <map|stops|routes|core-smoke>',
  );
  process.exit(1);
}

const baseDir = path.join(process.cwd(), 'tests', 'e2e', 'specs', group);

if (!fs.existsSync(baseDir)) {
  console.error(`Cypress group directory does not exist: ${baseDir}`);
  process.exit(1);
}

const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.cy.ts')) {
      files.push(path.relative(process.cwd(), fullPath));
    }
  }
}

walk(baseDir);

if (files.length === 0) {
  console.error(`No Cypress specs found for group "${group}"`);
  process.exit(1);
}

console.log(`[cypress:${group}] discovered ${files.length} spec file(s):`);
for (const file of files) {
  console.log(` - ${file}`);
}

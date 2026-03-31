import { REQUIRED_CHECKS } from './_gate-utils.mjs';

const availableRaw = process.env.AVAILABLE_CHECKS;

if (!availableRaw) {
  console.log('AVAILABLE_CHECKS not provided; validating static required check set only.');
  console.log(`Required checks (${REQUIRED_CHECKS.length}): ${REQUIRED_CHECKS.join(', ')}`);
  process.exit(0);
}

const available = new Set(
  availableRaw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

const missing = REQUIRED_CHECKS.filter((name) => !available.has(name));

if (missing.length > 0) {
  console.error(`Missing required checks: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('All required checks are present.');

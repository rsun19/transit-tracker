import { runCommand } from './_gate-utils.mjs';

runCommand('node', ['--test', 'tests/performance/ci-budgets.spec.mjs'], 'performance');

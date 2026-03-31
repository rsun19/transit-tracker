import { runCommand } from './_gate-utils.mjs';

const gate = process.argv[2];

const gateCommands = {
  lint: ['npm', ['run', 'lint']],
  unit: ['npm', ['run', 'test:unit']],
  integration: ['npm', ['run', 'test:integration', '--prefix', 'backend']],
  contract: ['npm', ['run', 'test:contract', '--prefix', 'backend']],
  accessibility: ['npm', ['run', 'test:a11y']],
  performance: ['npm', ['run', 'test:performance']],
};

if (!gate || !(gate in gateCommands)) {
  console.error(
    'Usage: node scripts/ci/run-gate.mjs <lint|unit|integration|contract|accessibility|performance>',
  );
  process.exit(1);
}

const [command, args] = gateCommands[gate];
runCommand(command, args, gate);
